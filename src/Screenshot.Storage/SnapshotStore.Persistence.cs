using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Screenshot.Storage;

public sealed partial class SnapshotStore
{
    // 原图先原子写入，文档更新与容量淘汰一起提交；提交前失败只留下可回收孤立文件。
    private SnapshotSaveResult SaveCore(string id,long revision,JsonElement document,CancellationToken token)
    {
        using var connection = OpenConnection();
        try
        {
            using (var transaction = connection.BeginTransaction(deferred:false))
            {
                token.ThrowIfCancellationRequested();
                using var command = connection.CreateCommand(); command.Transaction = transaction;
                command.CommandText = "SELECT revision FROM snapshots WHERE document_id=$id;";
                command.Parameters.AddWithValue("$id",id);
                if (command.ExecuteScalar() is long current && revision <= current)
                    return new(false,true,id,current);
                var prepared = SnapshotDocumentCodec.Prepare(document,token);
                if (prepared.Image is not null && prepared.Image.LongLength > _options.MaxAssetBytes)
                    throw new SnapshotStoreException("capacity_exceeded", "此原图大于恢复容量上限，现有恢复已保留。");
                if (prepared.Image is not null)
                {
                    WriteAsset(prepared.Hash!,prepared.Image,token);
                    command.CommandText = "INSERT OR IGNORE INTO assets(sha256,byte_length) VALUES($hash,$bytes);";
                    command.Parameters.Clear(); command.Parameters.AddWithValue("$hash",prepared.Hash!); command.Parameters.AddWithValue("$bytes",prepared.Image.LongLength);
                    command.ExecuteNonQuery();
                    command.CommandText = "SELECT byte_length FROM assets WHERE sha256=$hash;";
                    command.Parameters.RemoveAt("$bytes");
                    if (Convert.ToInt64(command.ExecuteScalar(),CultureInfo.InvariantCulture) != prepared.Image.LongLength) throw Corrupt();
                }
                command.CommandText = """
                    INSERT INTO snapshots(document_id,revision,document_json,asset_sha256,name,updated_at_utc)
                    VALUES($id,$revision,$json,$hash,$name,$updated)
                    ON CONFLICT(document_id) DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json,
                    asset_sha256=excluded.asset_sha256,name=excluded.name,updated_at_utc=excluded.updated_at_utc
                    WHERE excluded.revision>snapshots.revision;
                    """;
                command.Parameters.Clear(); command.Parameters.AddWithValue("$id",id); command.Parameters.AddWithValue("$revision",revision);
                command.Parameters.AddWithValue("$json",prepared.Json); command.Parameters.AddWithValue("$hash",(object?)prepared.Hash ?? DBNull.Value);
                command.Parameters.AddWithValue("$name",prepared.Name); command.Parameters.AddWithValue("$updated",DateTimeOffset.UtcNow.ToString("O",CultureInfo.InvariantCulture));
                token.ThrowIfCancellationRequested(); command.ExecuteNonQuery();
                // 淘汰仅在新快照事务内生效，任何失败或取消都会同时恢复旧引用与旧文档。
                PruneCapacity(connection,transaction,id,token);
                command.CommandText = "DELETE FROM assets WHERE NOT EXISTS (SELECT 1 FROM snapshots WHERE asset_sha256=assets.sha256);";
                command.Parameters.Clear(); command.ExecuteNonQuery();
                token.ThrowIfCancellationRequested(); transaction.Commit();
            }
        }
        catch
        {
            // using 已回滚事务，此时才可依据最新引用清理失败保存产生的孤立文件。
            TryCollectAssets(connection);
            throw;
        }
        return new(true,false,id,revision,!TryCollectAssets(connection));
    }

    // 按最近保存时间淘汰旧文档，容量按唯一被引用原图计算，永远保留本次新快照。
    private void PruneCapacity(SqliteConnection connection,SqliteTransaction transaction,string savedId,CancellationToken token)
    {
        using var command = connection.CreateCommand(); command.Transaction = transaction;
        while (true)
        {
            token.ThrowIfCancellationRequested();
            command.CommandText = "SELECT COUNT(*) FROM snapshots;"; command.Parameters.Clear();
            long count = Convert.ToInt64(command.ExecuteScalar(),CultureInfo.InvariantCulture);
            command.CommandText = "SELECT COALESCE(SUM(byte_length),0) FROM assets WHERE EXISTS (SELECT 1 FROM snapshots WHERE asset_sha256=assets.sha256);";
            long bytes = Convert.ToInt64(command.ExecuteScalar(),CultureInfo.InvariantCulture);
            if (count <= _options.MaxDocuments && bytes <= _options.MaxAssetBytes) return;
            command.CommandText = "SELECT document_id FROM snapshots WHERE document_id<>$id ORDER BY updated_at_utc ASC,rowid ASC LIMIT 1;";
            command.Parameters.AddWithValue("$id",savedId);
            var oldest = command.ExecuteScalar() as string;
            if (oldest is null) throw new SnapshotStoreException("capacity_exceeded", "此文档超出恢复容量上限，现有恢复已保留。");
            command.CommandText = "DELETE FROM snapshots WHERE document_id=$oldest;";
            command.Parameters.Clear(); command.Parameters.AddWithValue("$oldest",oldest); command.ExecuteNonQuery();
        }
    }
}
