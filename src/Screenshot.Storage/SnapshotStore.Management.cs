using Microsoft.Data.Sqlite;

namespace Screenshot.Storage;
public sealed partial class SnapshotStore
{
    /// <summary>只统计元数据和去重原图容量，不读取或返回用户图像与文字。</summary>
    public Task<SnapshotUsage> GetUsageAsync(CancellationToken token=default)=>RunAsync(ct=>{
        using var connection=OpenConnection();using var transaction=connection.BeginTransaction(deferred:false);
        using var command=connection.CreateCommand();command.Transaction=transaction;
        command.CommandText="SELECT COUNT(*) FROM snapshots;";var count=Convert.ToInt32(command.ExecuteScalar());
        command.CommandText="SELECT COALESCE(SUM(byte_length),0) FROM assets WHERE EXISTS(SELECT 1 FROM snapshots WHERE asset_sha256=assets.sha256);";
        var bytes=Convert.ToInt64(command.ExecuteScalar());ct.ThrowIfCancellationRequested();transaction.Commit();
        return new SnapshotUsage(count,bytes,_options.MaxDocuments,_options.MaxAssetBytes);
    },token,readOnly:true);
    /// <summary>先校验全部 ID，再在一个事务里删除；取消/中断不能造成半批删除。</summary>
    public Task<SnapshotBatchDeleteResult> DeleteManyAsync(IReadOnlyList<string> documentIds,CancellationToken token=default)
    {
        if(documentIds.Count is <1 or >1000)throw new SnapshotStoreException("invalid_document_id","请选择1至1000条恢复记录。");
        foreach(var id in documentIds)ValidateIdentity(id);
        var ids=documentIds.Distinct(StringComparer.Ordinal).ToArray();
        return RunAsync(ct=>{
            using var connection=OpenConnection();var deleted=0;
            using(var transaction=connection.BeginTransaction(deferred:false))
            {
                using var command=connection.CreateCommand();command.Transaction=transaction;
                command.CommandText="DELETE FROM snapshots WHERE document_id=$id;";var parameter=command.Parameters.Add("$id",SqliteType.Text);
                foreach(var id in ids){ct.ThrowIfCancellationRequested();parameter.Value=id;deleted+=command.ExecuteNonQuery();}
                command.Parameters.Clear();command.CommandText="DELETE FROM assets WHERE NOT EXISTS(SELECT 1 FROM snapshots WHERE asset_sha256=assets.sha256);";command.ExecuteNonQuery();
                ct.ThrowIfCancellationRequested();transaction.Commit();
            }
            return new SnapshotBatchDeleteResult(deleted,!TryCollectAssets(connection));
        },token);
    }
}
