using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Screenshot.App;

// 凭据仅绑定当前网页已经完整校验的文档修订，不持有图片或文档 JSON。
internal sealed record ValidatedEditorCheckpoint(
    [property: JsonPropertyName("documentId")] string DocumentId,
    [property: JsonPropertyName("revision")] long Revision,
    [property: JsonPropertyName("token")] string Token);

// 仅校验离开时的内存状态与输出身份；不生成存储身份或写入恢复快照。
internal sealed class EditorCheckpoint
{
    public ValidatedEditorCheckpoint? Known { get; private set; }
    public void Reset() => Known = null;

    // 首次及修订变化时完整校验；相同修订必须回传宿主凭据，仍检查错误与输出身份。
    public void Validate(JsonElement value, string? expectedId = null, long? expectedRevision = null)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new IOException("编辑器没有提供操作状态，已保留当前编辑。");
        if (value.TryGetProperty("error", out var error)) throw new IOException(error.GetString() ?? "当前编辑尚不能安全收起。");
        if (expectedId is not null && (!value.TryGetProperty("documentId", out var actualId) || actualId.GetString() != expectedId
            || !value.TryGetProperty("revision", out var actualRevision) || actualRevision.GetInt64() != expectedRevision))
            throw new IOException("内容已改变，已保留当前编辑，请重新输出。");
        if (value.TryGetProperty("empty", out var empty) && empty.ValueKind == JsonValueKind.True) { Reset(); return; }
        var documentId = value.GetProperty("documentId").GetString();
        if (!Guid.TryParse(documentId, out _) || !value.TryGetProperty("revision", out var revision) || revision.GetInt64() < 0)
            throw new IOException("文档身份无效，已保留当前编辑。");
        var currentRevision = revision.GetInt64();
        if (!value.TryGetProperty("document", out var document))
        {
            if (Known is not { } known || documentId != known.DocumentId || currentRevision != known.Revision
                || !value.TryGetProperty("validationToken", out var token) || token.ValueKind != JsonValueKind.String || token.GetString() != known.Token)
                throw new IOException("文档校验状态已失效，已保留当前编辑，请重试。");
            return;
        }
        NativeImages.ValidateProject(document);
        Known = new(documentId!, currentRevision, Guid.NewGuid().ToString("N"));
    }
}
