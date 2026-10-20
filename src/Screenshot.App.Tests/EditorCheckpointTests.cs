using System.IO;
using System.Text.Json;
using Screenshot.App;

internal static class EditorCheckpointTests
{
    internal static int Run()
    {
        var checks = 0;
        void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
        void Reject(Action action) { try { action(); } catch (Exception error) when (error is IOException or InvalidOperationException) { checks++; return; } throw new Exception("离开保护应拒绝无效或过期状态"); }
        var id = Guid.NewGuid().ToString();
        JsonElement Snapshot(string documentId, long revision = 7, bool projectSaved = false, bool empty = false) => JsonSerializer.SerializeToElement(new
        {
            documentId, revision, projectSaved, empty,
            document = new { schemaVersion = 2, image = (object?)null, editor = new { text = "尚未保存的校对" } }
        });
        var checkpoint = new EditorCheckpoint();
        var first = checkpoint.Prepare(Snapshot(id), id, 7)!.Value;
        Check(Guid.TryParse(first.Id, out _) && first.Revision == 1, "独立恢复身份与修订");
        var retry = checkpoint.Prepare(Snapshot(id), id, 7)!.Value;
        Check(first.Id == retry.Id && retry.Revision > first.Revision, "丢失确认后重试推进存储修订");
        var other = checkpoint.Prepare(Snapshot(Guid.NewGuid().ToString()))!.Value;
        Check(other.Id != first.Id, "不同文档隔离恢复身份");
        Check(checkpoint.Prepare(Snapshot(id, projectSaved: true), id, 7) is null, "已保存当前可编辑项目允许离开");
        Check(checkpoint.Prepare(Snapshot(id, empty: true), id, 7) is null, "空文档不增加恢复记录");
        Reject(() => checkpoint.Prepare(Snapshot(id), id, 6));
        Reject(() => checkpoint.Prepare(Snapshot(id, projectSaved: true), Guid.NewGuid().ToString(), 7));
        Reject(() => checkpoint.Prepare(JsonSerializer.SerializeToElement(new { error = "画布文字尚未提交" })));
        Reject(() => checkpoint.Prepare(JsonSerializer.SerializeToElement<object?>(null)));
        Reject(() => checkpoint.Prepare(Snapshot("invalid-id")));
        Reject(() => checkpoint.Prepare(Snapshot(id, -1)));
        return checks;
    }
}
