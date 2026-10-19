using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Screenshot.Storage;

/// <summary>SQLite 恢复目录，后台执行所有 I/O，文档与资产提交分离并安全回收孤立原图。</summary>
public sealed partial class SnapshotStore : IDisposable
{
    private readonly string _root;
    private readonly string _assets;
    private readonly string _assetPrefix;
    private readonly string _database;
    private readonly SnapshotStoreOptions _options;
    private readonly SemaphoreSlim _gate = new(1,1);
    private readonly CancellationTokenSource _lifetime = new();
    private int _disposed;

    /// <summary>只记录恢复位置及容量，不列出或自动打开已有私人文档。</summary>
    public SnapshotStore(string rootDirectory, SnapshotStoreOptions? options = null)
    {
        _options = options ?? new();
        if (_options.MaxDocuments is < 1 or > 1000 || _options.MaxAssetBytes < 1)
            throw new SnapshotStoreException("invalid_options", "恢复容量设置无效，文档条数应为 1 至 1000，原图容量应大于零。");
        try { _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(rootDirectory)); }
        catch (Exception error) when (error is ArgumentException or NotSupportedException)
        { throw new SnapshotStoreException("invalid_directory", "恢复目录无效，请检查本地存储设置。"); }
        if (_root == Path.GetPathRoot(_root)) throw new SnapshotStoreException("invalid_directory", "请选择专用恢复目录，不能使用磁盘根目录。");
        _assets = Path.Combine(_root,"assets"); _assetPrefix = _assets + Path.DirectorySeparatorChar;
        _database = Path.Combine(_root,"snapshots.db");
    }

    /// <summary>只接受比当前更高的修订，旧请求不会覆盖已提交恢复；提交前取消会回滚。</summary>
    public Task<SnapshotSaveResult> SaveAsync(string documentId,long revision,JsonElement document,CancellationToken cancellationToken=default)
    {
        ValidateIdentity(documentId);
        if (revision < 0) throw new SnapshotStoreException("invalid_revision", "文档修订号不能为负数。");
        JsonElement snapshot;
        try { snapshot = document.Clone(); }
        catch (Exception error) when (error is ObjectDisposedException or InvalidOperationException)
        { throw new SnapshotStoreException("invalid_document", "恢复文档已经不可读取，请重新保存。"); }
        return RunAsync(token => SaveCore(documentId,revision,snapshot,token),cancellationToken);
    }

    /// <summary>只返回恢复摘要，不解码原图或自动加载编辑内容。</summary>
    public Task<IReadOnlyList<SnapshotSummary>> ListAsync(CancellationToken cancellationToken=default) => RunAsync<IReadOnlyList<SnapshotSummary>>(token =>
    {
        using var connection = OpenConnection(); using var command = connection.CreateCommand();
        command.CommandText = "SELECT document_id,revision,name,updated_at_utc FROM snapshots ORDER BY updated_at_utc DESC,rowid DESC;";
        using var reader = command.ExecuteReader(); var entries = new List<SnapshotSummary>();
        while (reader.Read())
        {
            token.ThrowIfCancellationRequested();
            if (!DateTimeOffset.TryParse(reader.GetString(3),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out var updated))
                throw Corrupt();
            entries.Add(new(reader.GetString(0),reader.GetInt64(1),reader.GetString(2),updated));
        }
        return entries;
    },cancellationToken);

    /// <summary>仅在用户明确恢复时读取文档，并在返回前核对原图长度与 SHA256。</summary>
    public Task<SnapshotLoadResult> LoadAsync(string documentId,CancellationToken cancellationToken=default)
    {
        ValidateIdentity(documentId);
        return RunAsync(token =>
        {
            using var connection = OpenConnection();
            // 加载也持短写保留锁，使跨实例 GC 无法在读行后、读原图前删除资产。
            using var transaction = connection.BeginTransaction(deferred:false);
            using var command = connection.CreateCommand(); command.Transaction = transaction;
            command.CommandText = "SELECT s.revision,s.document_json,s.asset_sha256,a.byte_length FROM snapshots s LEFT JOIN assets a ON a.sha256=s.asset_sha256 WHERE s.document_id=$id;";
            command.Parameters.AddWithValue("$id",documentId);
            long revision; string json; string? hash; long? bytes;
            using (var reader = command.ExecuteReader())
            {
                if (!reader.Read()) throw new SnapshotStoreException("not_found", "此恢复记录不存在或已按容量策略清理。");
                revision = reader.GetInt64(0); json = reader.GetString(1);
                hash = reader.IsDBNull(2) ? null : reader.GetString(2);
                bytes = reader.IsDBNull(3) ? null : reader.GetInt64(3);
            }
            token.ThrowIfCancellationRequested();
            byte[]? image = hash is null ? null : ReadAsset(hash,bytes,token);
            var document = SnapshotDocumentCodec.Restore(json,image);
            token.ThrowIfCancellationRequested(); transaction.Commit();
            return new SnapshotLoadResult(documentId,revision,document);
        },cancellationToken);
    }

    /// <summary>只删除指定恢复；资产在提交后依据所有剩余引用清理。</summary>
    public Task<SnapshotDeleteResult> DeleteAsync(string documentId,CancellationToken cancellationToken=default)
    {
        ValidateIdentity(documentId);
        return RunAsync(token =>
        {
            using var connection = OpenConnection(); bool deleted;
            using (var transaction = connection.BeginTransaction(deferred:false))
            {
                using var command = connection.CreateCommand(); command.Transaction = transaction;
                command.CommandText = "DELETE FROM snapshots WHERE document_id=$id;"; command.Parameters.AddWithValue("$id",documentId);
                token.ThrowIfCancellationRequested(); deleted = command.ExecuteNonQuery() > 0;
                command.CommandText = "DELETE FROM assets WHERE NOT EXISTS (SELECT 1 FROM snapshots WHERE asset_sha256=assets.sha256);";
                command.Parameters.Clear(); command.ExecuteNonQuery();
                token.ThrowIfCancellationRequested(); transaction.Commit();
            }
            return new SnapshotDeleteResult(deleted,!TryCollectAssets(connection));
        },cancellationToken);
    }

    // SQLite 的异步 ADO 方法仍同步执行，因此显式放到后台，且不跨线程共享连接。
    private async Task<T> RunAsync<T>(Func<CancellationToken,T> action,CancellationToken token)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed)!=0,this);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(token,_lifetime.Token); bool entered = false;
        try
        {
            await _gate.WaitAsync(linked.Token).ConfigureAwait(false); entered = true;
            return await Task.Run(() => action(linked.Token),linked.Token).ConfigureAwait(false);
        }
        catch (SqliteException) when (linked.IsCancellationRequested) { throw new OperationCanceledException(linked.Token); }
        catch (SqliteException error) when (error.SqliteErrorCode is 5 or 6)
        { throw new SnapshotStoreException("store_busy", "恢复存储正忙，请稍后重试。"); }
        catch (SqliteException error) when (error.SqliteErrorCode is 11 or 26)
        { throw new SnapshotStoreException("database_corrupt", "恢复数据库已损坏，无法安全读取。"); }
        catch (SqliteException) { throw new SnapshotStoreException("store_failed", "恢复存储操作失败，请稍后重试或检查恢复列表。"); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { throw new SnapshotStoreException("store_io_error", "恢复文件操作失败，请检查空间、权限及文件是否被占用。"); }
        catch (JsonException) { throw Corrupt(); }
        finally { if (entered) _gate.Release(); }
    }

    // 首次调用创建专用目录；WAL/FULL 与明确的 schema 版本保证事务持久性。
    private SqliteConnection OpenConnection()
    {
        EnsureSafeDirectories();
        if (File.Exists(_database) && File.GetAttributes(_database).HasFlag(FileAttributes.ReparsePoint))
            throw new SnapshotStoreException("unsafe_path", "恢复数据库不能使用链接文件。");
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder {
            DataSource = _database,Mode = SqliteOpenMode.ReadWriteCreate,Cache = SqliteCacheMode.Private,Pooling = false,DefaultTimeout = 2
        }.ToString());
        try
        {
            connection.Open(); using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;"; command.ExecuteNonQuery();
            using var transaction = connection.BeginTransaction(deferred:false); command.Transaction = transaction;
            command.CommandText = "PRAGMA user_version;"; long version = Convert.ToInt64(command.ExecuteScalar(),CultureInfo.InvariantCulture);
            if (version is not (0 or 1)) throw new SnapshotStoreException("schema_unsupported", "恢复数据库版本较新，请使用兼容版本应用，现有数据未修改。");
            command.CommandText = """
                CREATE TABLE IF NOT EXISTS assets (sha256 TEXT PRIMARY KEY,byte_length INTEGER NOT NULL CHECK(byte_length>0));
                CREATE TABLE IF NOT EXISTS snapshots (
                  document_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>=0),document_json TEXT NOT NULL,
                  asset_sha256 TEXT NULL REFERENCES assets(sha256),name TEXT NOT NULL,updated_at_utc TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS snapshots_updated ON snapshots(updated_at_utc);
                PRAGMA user_version=1;
                """;
            command.ExecuteNonQuery(); transaction.Commit(); return connection;
        }
        catch { connection.Dispose(); throw; }
    }

    private static void ValidateIdentity(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100 || !char.IsAsciiLetterOrDigit(id[0]) || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            throw new SnapshotStoreException("invalid_document_id", "恢复文档标识无效，不能包含路径或特殊字符。");
    }

    private static SnapshotStoreException Corrupt() => new("snapshot_corrupt", "恢复文档或原图已损坏，无法安全恢复。");

    /// <summary>取消排队和未提交操作，再等待连接与原图文件释放；不删除用户恢复。</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed,1)!=0) return;
        _lifetime.Cancel(); _gate.Wait();
        try { _lifetime.Dispose(); }
        finally { _gate.Release(); }
    }
}
