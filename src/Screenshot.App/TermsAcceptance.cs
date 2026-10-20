using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Screenshot.App;

internal sealed record TermsDocument(string Title, string File, string Sha256);

// 先校验随包核心条款，再对全部可读告知生成稳定摘要；不加载宿主、用户配置或网络。
internal sealed class TermsAgreement
{
    internal string Root { get; }
    internal string Version { get; }
    internal string Digest { get; }
    internal IReadOnlyList<TermsDocument> Documents { get; }
    private TermsAgreement(string root, string version, List<TermsDocument> documents)
    {
        Root = root; Version = version; Documents = documents.AsReadOnly();
        var identity = version + "\n" + string.Join("\n", documents.OrderBy(d => d.File, StringComparer.Ordinal).Select(d => d.File + "\0" + d.Sha256));
        Digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
    }
    internal static TermsAgreement Load(string root)
    {
        root = Path.GetFullPath(root);
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "legal", "terms-manifest.json")));
        var manifest = json.RootElement;
        if (manifest.GetProperty("schemaVersion").GetInt32() != 1) throw new InvalidDataException("条款清单版本不受支持。");
        var version = manifest.GetProperty("version").GetString();
        if (string.IsNullOrWhiteSpace(version) || version.Length > 80) throw new InvalidDataException("条款版本无效。");
        var docs = new List<TermsDocument>(); var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        void Add(string title, string relative, string? expected)
        {
            if (!seen.Add(relative)) { if (expected is not null) throw new InvalidDataException("条款文件重复。"); return; }
            var full = SafeFile(root, relative); var info = new FileInfo(full);
            if (!info.Exists || info.Length > 2 * 1024 * 1024 || (total += info.Length) > 64 * 1024 * 1024 || docs.Count >= 4096)
                throw new InvalidDataException("条款文件缺失或超出读取限额。");
            using var stream = File.OpenRead(full);
            var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (expected is not null && !string.Equals(hash, expected, StringComparison.Ordinal)) throw new InvalidDataException("条款文件校验失败：" + relative);
            docs.Add(new(title, relative, hash));
        }
        foreach (var d in manifest.GetProperty("documents").EnumerateArray())
            Add(d.GetProperty("title").GetString() ?? "条款", d.GetProperty("file").GetString() ?? "", d.GetProperty("sha256").GetString() ?? "");
        foreach (var required in new[] { "legal/TERMS.zh-CN.txt", "legal/COPYRIGHT.txt", "THIRD-PARTY-NOTICES.md", "licenses/Windows-SDK-LICENSE.rtf", "licenses/Windows-SDK-REDIST.md", "licenses/Windows-SDK-NOTICE.zh-CN.txt", "licenses/CsWinRT-LICENSE.txt", "licenses/cswinrt-license-sources.json" })
            if (!seen.Contains(required)) throw new InvalidDataException("缺少必要条款：" + required);
        // NuGet/npm完整告知在发布审查时加入；内容变化同样要求重新确认。
        foreach (var folder in new[] { "licenses", "dependency-licenses", "native-provenance/licenses", "models/pp-ocrv5-mobile" })
        {
            var directory = Path.Combine(root, folder);
            if (!Directory.Exists(directory)) continue;
            foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.Ordinal))
            {
                var name = Path.GetFileName(file);
                if (folder.StartsWith("models", StringComparison.Ordinal) && !(name.StartsWith("LICENSE", StringComparison.OrdinalIgnoreCase) || name.StartsWith("NOTICE", StringComparison.OrdinalIgnoreCase))) continue;
                if (!new[] { ".txt", ".md", ".rtf" }.Contains(Path.GetExtension(file).ToLowerInvariant()) && !new[] { "LICENSE", "NOTICE", "COPYING" }.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                Add(relative, relative, null);
            }
        }
        return new(root, version, docs);
    }
    internal string Resolve(TermsDocument document) => SafeFile(Root, document.File);
    // 仅允许随包普通文件，拒绝路径越界和重解析目录/文件。
    private static string SafeFile(string root, string relative)
    {
        if (Path.IsPathRooted(relative) || relative.Contains('\\') || relative.Split('/').Any(p => p is "" or "." or "..")) throw new InvalidDataException("条款路径无效。");
        var full = Path.GetFullPath(Path.Combine(root, relative));
        if (!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("条款路径越界。");
        for (var path = full; !string.Equals(path, root, StringComparison.OrdinalIgnoreCase); path = Path.GetDirectoryName(path)!)
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("条款不允许链接。");
        return full;
    }
}

internal sealed record TermsReceipt(int SchemaVersion, string Version, string Digest, DateTimeOffset AcceptedAtUtc, string AppVersion);

internal sealed class TermsAcceptanceStore(string path)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal bool IsCurrent(TermsAgreement agreement)
    {
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length > 4096) return false;
            var receipt = JsonSerializer.Deserialize<TermsReceipt>(File.ReadAllText(path), Json);
            return receipt is { SchemaVersion: 1 } && receipt.Version == agreement.Version && receipt.Digest == agreement.Digest
                && receipt.AcceptedAtUtc > DateTimeOffset.UnixEpoch && receipt.AcceptedAtUtc <= DateTimeOffset.UtcNow.AddMinutes(5);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or NotSupportedException) { return false; }
    }
    internal void Save(TermsAgreement agreement, string appVersion)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(path))!; Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, "terms-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(new TermsReceipt(1, agreement.Version, agreement.Digest, DateTimeOffset.UtcNow, appVersion), Json));
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

// 只有精确条款的既有本地记录或当前使用者明确勾选并成功保存，才可创建主宿主。
internal sealed class TermsStartup
{
    internal TermsAgreement Agreement { get; }
    private readonly TermsAcceptanceStore _store;
    private readonly string _appVersion;
    internal bool IsAuthorized { get; private set; }
    internal TermsStartup(TermsAgreement agreement, TermsAcceptanceStore store, string appVersion)
    { Agreement = agreement; _store = store; _appVersion = appVersion; IsAuthorized = store.IsCurrent(agreement); }
    internal bool TryAccept(bool checkedByUser, out string error)
    {
        error = "";
        if (!checkedByUser) { error = "请先阅读并勾选同意，或选择退出。"; return false; }
        try
        {
            // 窗口展示期间文件改变也不能沿用旧同意，要求重新加载并审阅。
            var current = TermsAgreement.Load(Agreement.Root);
            if (current.Version != Agreement.Version || current.Digest != Agreement.Digest)
            { error = "条款文件已变化，请退出后重新审阅。"; return false; }
            _store.Save(Agreement, _appVersion); IsAuthorized = true; return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException)
        { error = "无法保存本机条款确认，尚未启动应用。请重试或退出。"; return false; }
    }
    internal void RequireAccepted() { if (!IsAuthorized) throw new InvalidOperationException("尚未同意当前使用条款。"); }
    internal bool Start(Action start) { if (!IsAuthorized) return false; start(); return true; }
}
