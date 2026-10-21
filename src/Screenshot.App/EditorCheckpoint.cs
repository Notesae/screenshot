using System;
using System.IO;
using System.Text.Json;

namespace Screenshot.App;

// 仅校验离开时的内存状态与输出身份；不生成存储身份或写入恢复快照。
internal sealed class EditorCheckpoint
{
    public void Validate(JsonElement value, string? expectedId = null, long? expectedRevision = null)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new IOException("编辑器没有提供操作状态，已保留当前编辑。");
        if (value.TryGetProperty("error", out var error)) throw new IOException(error.GetString() ?? "当前编辑尚不能安全收起。");
        if (expectedId is not null && (!value.TryGetProperty("documentId", out var actualId) || actualId.GetString() != expectedId
            || !value.TryGetProperty("revision", out var actualRevision) || actualRevision.GetInt64() != expectedRevision))
            throw new IOException("内容已改变，已保留当前编辑，请重新输出。");
        if (value.TryGetProperty("empty", out var empty) && empty.ValueKind == JsonValueKind.True) return;
        var documentId = value.GetProperty("documentId").GetString();
        if (!Guid.TryParse(documentId, out _) || !value.TryGetProperty("revision", out var revision) || revision.GetInt64() < 0)
            throw new IOException("文档身份无效，已保留当前编辑。");
        var document = value.GetProperty("document");
        NativeImages.ValidateProject(document);
    }
}
