using System.Text.Json;

namespace Screenshot.Storage;

/// <summary>恢复容量：文档条数及被当前文档引用的去重原图字节数。</summary>
public sealed record SnapshotStoreOptions(int MaxDocuments = 20, long MaxAssetBytes = 256L * 1024 * 1024);
/// <summary>过期修订不写入；清理暂缓不等于已提交的保存失败。</summary>
public sealed record SnapshotSaveResult(bool Saved, bool Stale, string DocumentId, long Revision, bool CleanupPending = false);
/// <summary>恢复列表只提供标识、修订、安全名称和时间，不自动读取原图或编辑文字。</summary>
public sealed record SnapshotSummary(string DocumentId, long Revision, string Name, DateTimeOffset UpdatedAtUtc);
/// <summary>用户明确恢复后返回完整项目 JSON，重新嵌入校验通过的原图。</summary>
public sealed record SnapshotLoadResult(string DocumentId, long Revision, JsonElement Document);
/// <summary>删除完成后可单独指示未引用资产清理是否需要稍后重试。</summary>
public sealed record SnapshotDeleteResult(bool Deleted, bool CleanupPending = false);
/// <summary>可显示的存储错误；不附加原始 SQL、路径、文档文字或底层异常。</summary>
public sealed class SnapshotStoreException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

// 仅在单次保存中持有原图，数据库 JSON 不包含 image.dataUrl。
internal sealed record PreparedSnapshot(string Json, string Name, byte[]? Image, string? Hash);
