using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;

namespace Screenshot.App.Updates;

internal static class PortablePackage
{
    internal const long MaxExpandedBytes = 2_000_000_000;
    internal static string Digest(string path) { using var stream = File.OpenRead(path); return Convert.ToHexStringLower(SHA256.HashData(stream)); }
    // 同时读取旧平铺包与新 app 子目录；更新工作进程直接运行宿主，以跟踪真实生命周期。
    internal static string PayloadRoot(string root) => Directory.Exists(Path.Combine(root, "app")) ? Path.Combine(root, "app") : root;
    internal static string Executable(string root) => Path.Combine(PayloadRoot(root), "Screenshot.exe");
    // 宿主从 app 启动时，整包替换边界仍是包含原生入口及完整清单的父目录。
    internal static string InstallationRoot(string host)
    {
        var directory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(host));
        var parent = Path.GetDirectoryName(directory);
        return Path.GetFileName(directory).Equals("app", StringComparison.OrdinalIgnoreCase) && parent is not null
            && File.Exists(Path.Combine(parent, "Screenshot.exe")) && File.Exists(Path.Combine(parent, "SHA256SUMS.txt")) ? parent : directory;
    }

    // Windows 路径的别名、设备名、ADS、链接和祖先重解析点均不能进入更新目录。
    internal static string Child(string root, string relative)
    {
        if (relative.Length == 0 || relative.Length > 220 || relative.Contains('\\') || relative.Contains(':') || relative.StartsWith('/')) throw new InvalidDataException("更新包路径无效。");
        foreach (var part in relative.Split('/'))
            if (part.Length == 0 || part is "." or ".." || part.EndsWith('.') || part.EndsWith(' ') || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                throw new InvalidDataException("更新包包含不安全的 Windows 文件名。");
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("更新包路径越界。");
        NoLinks(full); return full;
    }
    internal static void NoLinks(string path)
    {
        for (var p = Path.GetFullPath(path); p is not null; p = Path.GetDirectoryName(p))
            if ((File.Exists(p) || Directory.Exists(p)) && (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0) throw new IOException("更新目录包含链接或重解析点，不能安全替换。");
    }
    internal static void Extract(string zip, string destination, ReleaseVersion version, CancellationToken token)
    {
        if (Directory.Exists(destination)) throw new IOException("更新暂存目录已存在。");
        NoLinks(destination); Directory.CreateDirectory(destination);
        using var archive = ZipFile.OpenRead(zip);
        if (archive.Entries.Count > 10000) throw new InvalidDataException("更新包文件数过多。");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
        foreach (var entry in archive.Entries)
        {
            token.ThrowIfCancellationRequested();
            var directory = entry.FullName.EndsWith('/'); var name = directory ? entry.FullName[..^1] : entry.FullName;
            var path = Child(destination, name);
            if (!seen.Add(name) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("更新包包含重复路径或链接。");
            total = checked(total + entry.Length); if (total > MaxExpandedBytes || entry.Length > MaxPackageBytesPerFile) throw new InvalidDataException("更新包解压大小超出限制。");
            if (directory) { if (entry.Length != 0) throw new InvalidDataException("更新包目录含数据。"); Directory.CreateDirectory(path); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using var input = entry.Open(); using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            var buffer = new byte[131072]; long written = 0;
            while (true)
            {
                token.ThrowIfCancellationRequested(); var count = input.Read(buffer); if (count == 0) break;
                written += count; if (written > entry.Length) throw new InvalidDataException("更新包文件长度无效。"); output.Write(buffer, 0, count);
            }
            if (written != entry.Length) throw new InvalidDataException("更新包文件已截断。");
            output.Flush(true);
        }
        Verify(destination, version, token);
    }
    private const long MaxPackageBytesPerFile = 600_000_000;

    // SHA 清单仅做完整性检查；官方身份来自固定 HTTPS API，不将同源 SHA 清单描述成签名。
    internal static string Verify(string root, ReleaseVersion? version, CancellationToken token)
    {
        NoLinks(root); var sums = Child(root, "SHA256SUMS.txt");
        if (!File.Exists(sums) || new FileInfo(sums).Length > 2 * 1024 * 1024) throw new InvalidDataException("缺少有效的便携包完整性清单；请将官方完整 ZIP 解压到新目录。");
        var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in File.ReadLines(sums))
        {
            token.ThrowIfCancellationRequested();
            if (line.Length < 67 || !Regex.IsMatch(line[..64], "^[0-9a-fA-F]{64}$") || line.Substring(64, 2) != "  ") throw new InvalidDataException("便携包校验清单格式无效。");
            var name = line[66..]; var path = Child(root, name);
            if (name.Equals("SHA256SUMS.txt", StringComparison.OrdinalIgnoreCase) || !expected.Add(name) || !File.Exists(path) || !Digest(path).Equals(line[..64], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("便携包文件校验失败：" + name);
        }
        var actual = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Walk(root, root, actual);
        actual.Remove("SHA256SUMS.txt");
        if (!actual.SetEquals(expected)) throw new InvalidDataException("目录包含清单外文件（可能是用户项目）或缺少文件；原目录保持不动。请使用新目录并排安装，用户设置仍保留在本机数据目录。");
        var prefix = PayloadRoot(root) == root ? "" : "app/";
        foreach (var required in new[] { "Screenshot.exe", prefix + "Screenshot.exe", prefix + "Screenshot.dll", prefix + "Screenshot.runtimeconfig.json", prefix + "web/index.html", prefix + "legal/terms-manifest.json", prefix + "sbom.cdx.json" })
            if (!expected.Contains(required)) throw new InvalidDataException("便携包缺少必要文件：" + required);
        if (version is not null)
        {
            if (ReadVersion(root) != version) throw new InvalidDataException("包内版本与官方发布版本不一致。");
        }
        return Digest(sums);
    }
    internal static ReleaseVersion ReadVersion(string root)
    {
        var bom = Child(PayloadRoot(root), "sbom.cdx.json"); if (new FileInfo(bom).Length > 8 * 1024 * 1024) throw new InvalidDataException("版本清单过大。");
        using var doc = JsonDocument.Parse(File.ReadAllText(bom));
        return ReleaseVersion.Parse(doc.RootElement.GetProperty("metadata").GetProperty("component").GetProperty("version").GetString()!);
    }
    private static void Walk(string root, string directory, HashSet<string> files)
    {
        foreach (var path in Directory.EnumerateFileSystemEntries(directory))
        {
            NoLinks(path);
            if (Directory.Exists(path)) Walk(root, path, files);
            else { files.Add(Path.GetRelativePath(root, path).Replace('\\', '/')); if (files.Count > 10000) throw new InvalidDataException("目录文件数过多。"); }
        }
    }
    internal static void CopyVerified(string source, string destination, CancellationToken token)
    {
        Verify(source, null, token); Directory.CreateDirectory(destination);
        foreach (var path in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            token.ThrowIfCancellationRequested(); var target = Child(destination, Path.GetRelativePath(source, path).Replace('\\', '/'));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(path, target, false);
        }
        Verify(destination, null, token);
    }
}
