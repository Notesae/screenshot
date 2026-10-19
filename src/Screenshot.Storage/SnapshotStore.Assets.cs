using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Screenshot.Storage;

public sealed partial class SnapshotStore
{
    // 只处理本服务命名的临时文件，不清理恢复目录中其他用户文件。
    private static readonly Regex TemporaryAssetName = new(@"^\.asset-[a-f0-9]{64}-[a-f0-9]{32}\.tmp$",RegexOptions.CultureInvariant);

    // 拒绝目录链接，确保后续生成的资产路径和清理目标仍在指定恢复目录内。
    private void EnsureSafeDirectories()
    {
        for (DirectoryInfo? directory = new(_root); directory is not null; directory = directory.Parent)
            if (directory.Exists && directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new SnapshotStoreException("unsafe_path", "恢复目录不能通过链接重定向到其他位置。");
        Directory.CreateDirectory(_root); Directory.CreateDirectory(_assets);
        if (new DirectoryInfo(_assets).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new SnapshotStoreException("unsafe_path", "恢复原图目录不能使用链接。");
    }

    private static bool ValidHash(string hash) => hash.Length == 64 && hash.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    // 数据库中的哈希也不可信，必须先限制为文件名再检查绝对路径范围。
    private string AssetPath(string hash)
    {
        if (!ValidHash(hash)) throw Corrupt();
        var path = Path.GetFullPath(Path.Combine(_assets,hash + ".png"));
        if (!path.StartsWith(_assetPrefix,StringComparison.OrdinalIgnoreCase))
            throw new SnapshotStoreException("unsafe_path", "恢复原图路径无效。");
        return path;
    }

    // 原图不可覆盖：同摘要必须校验现有文件；新图写同目录临时文件并刷盘后原子重命名。
    private void WriteAsset(string hash,byte[] image,CancellationToken token)
    {
        string target = AssetPath(hash);
        if (File.Exists(target)) { ReadAsset(hash,image.LongLength,token); return; }
        string temporary = Path.Combine(_assets,$".asset-{hash}-{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,128*1024,FileOptions.WriteThrough))
            {
                for (int offset = 0; offset < image.Length; offset += 128*1024)
                {
                    token.ThrowIfCancellationRequested(); stream.Write(image,offset,Math.Min(128*1024,image.Length-offset));
                }
                stream.Flush(flushToDisk:true);
            }
            token.ThrowIfCancellationRequested(); File.Move(temporary,target,overwrite:false);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    // 恢复前同时核对长度和 SHA，损坏或链接文件不能被当作原图返回。
    private byte[] ReadAsset(string hash,long? expectedBytes,CancellationToken token)
    {
        string path = AssetPath(hash);
        if (!expectedBytes.HasValue || expectedBytes.Value is < 33 or > SnapshotDocumentCodec.MaxImageBytes) throw Corrupt();
        if (!File.Exists(path)) throw new SnapshotStoreException("asset_missing", "恢复原图文件缺失，无法安全恢复此记录。");
        if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
            throw new SnapshotStoreException("unsafe_path", "恢复原图不能使用链接文件。");
        using var stream = new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read,128*1024,FileOptions.SequentialScan);
        if (stream.Length != expectedBytes.Value) throw Corrupt();
        var bytes = new byte[checked((int)expectedBytes.Value)];
        int offset = 0;
        while (offset < bytes.Length)
        {
            token.ThrowIfCancellationRequested();
            int read = stream.Read(bytes,offset,Math.Min(128*1024,bytes.Length-offset));
            if (read == 0) throw Corrupt(); offset += read;
        }
        token.ThrowIfCancellationRequested();
        if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(hash,StringComparison.OrdinalIgnoreCase)) throw Corrupt();
        return bytes;
    }

    // 提交之后重新保留 SQLite 写锁，跨实例保存/加载均不能与资产删除竞态。
    private bool TryCollectAssets(SqliteConnection connection)
    {
        try
        {
            EnsureSafeDirectories();
            using var transaction = connection.BeginTransaction(deferred:false);
            using var command = connection.CreateCommand(); command.Transaction = transaction;
            command.CommandText = "SELECT DISTINCT asset_sha256 FROM snapshots WHERE asset_sha256 IS NOT NULL;";
            var referenced = new HashSet<string>(StringComparer.Ordinal);
            using (var reader = command.ExecuteReader()) while (reader.Read())
            {
                string hash = reader.GetString(0); if (!ValidHash(hash)) return false; referenced.Add(hash);
            }
            bool pending = false;
            foreach (string candidate in Directory.EnumerateFiles(_assets,"*",SearchOption.TopDirectoryOnly))
            {
                string name = Path.GetFileName(candidate);
                bool immutable = name.EndsWith(".png",StringComparison.Ordinal) && ValidHash(name[..^4]);
                if (!immutable && !TemporaryAssetName.IsMatch(name)) continue;
                if (immutable && referenced.Contains(name[..^4])) continue;
                string path = Path.GetFullPath(candidate);
                if (!path.StartsWith(_assetPrefix,StringComparison.OrdinalIgnoreCase)) { pending = true; continue; }
                try
                {
                    if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) { pending = true; continue; }
                    File.Delete(path);
                }
                catch (FileNotFoundException) { }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { pending = true; }
            }
            transaction.Commit(); return !pending;
        }
        catch (Exception error) when (error is SqliteException or IOException or UnauthorizedAccessException or SnapshotStoreException)
        { return false; }
    }
}
