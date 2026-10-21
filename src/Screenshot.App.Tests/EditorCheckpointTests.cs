using System.IO;
using System.Text.Json;
using Screenshot.App;

// 离开校验仅验证内存身份；不生成恢复身份或执行存储操作。
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
        checkpoint.Validate(Snapshot(id),id,7);Check(true,"未手动保存的有效内容允许完成");
        checkpoint.Validate(Snapshot(id),id,7);Check(true,"重复校验不需要写入或存储修订");
        checkpoint.Validate(Snapshot(Guid.NewGuid().ToString()));Check(true,"切换文档只校验当前身份");
        checkpoint.Validate(Snapshot(id,projectSaved:true),id,7);Check(true,"手动项目保存不影响完成");
        checkpoint.Validate(Snapshot(id,empty:true),id,7);Check(true,"空文档允许离开");
        Reject(() => checkpoint.Validate(Snapshot(id), id, 6));
        Reject(() => checkpoint.Validate(Snapshot(id, projectSaved: true), Guid.NewGuid().ToString(), 7));
        Reject(() => checkpoint.Validate(JsonSerializer.SerializeToElement(new { error = "画布文字尚未提交" })));
        Reject(() => checkpoint.Validate(JsonSerializer.SerializeToElement<object?>(null)));
        Reject(() => checkpoint.Validate(Snapshot("invalid-id")));
        Reject(() => checkpoint.Validate(Snapshot(id, -1)));
        return checks;
    }
}
