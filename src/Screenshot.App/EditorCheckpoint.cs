using System;
using System.IO;
using System.Text.Json;

namespace Screenshot.App;

// 退出与覆盖前的快照使用独立恢复身份，不与前端自动保存的修订争用。
internal sealed class EditorCheckpoint
{
    private string? _documentId;
    private string _storageId = Guid.NewGuid().ToString();
    private long _revision;

    public (string Id, long Revision, JsonElement Document)? Prepare(JsonElement value, string? expectedId = null, long? expectedRevision = null)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new IOException("编辑器没有提供保存状态，已保留当前编辑。");
        if (value.TryGetProperty("error", out var error)) throw new IOException(error.GetString() ?? "当前编辑尚不能安全收起。");
        if (expectedId is not null && (!value.TryGetProperty("documentId", out var actualId) || actualId.GetString() != expectedId
            || !value.TryGetProperty("revision", out var actualRevision) || actualRevision.GetInt64() != expectedRevision))
            throw new IOException("内容已改变，已保留当前编辑，请重新输出。");
        if (value.TryGetProperty("empty", out var empty) && empty.ValueKind == JsonValueKind.True) return null;
        if (value.TryGetProperty("projectSaved", out var saved) && saved.ValueKind == JsonValueKind.True) return null;
        var documentId = value.GetProperty("documentId").GetString();
        if (!Guid.TryParse(documentId, out _) || !value.TryGetProperty("revision", out var revision) || revision.GetInt64() < 0)
            throw new IOException("保存身份无效，已保留当前编辑。");
        var document = value.GetProperty("document");
        NativeImages.ValidateProject(document);
        if (_documentId != documentId) { _documentId = documentId; _storageId = Guid.NewGuid().ToString(); _revision = 0; }
        return (_storageId, checked(++_revision), document.Clone());
    }
}
