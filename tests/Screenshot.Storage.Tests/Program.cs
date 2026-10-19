using System.Text.Json;
using System.Text;
using System.Buffers.Binary;
using Microsoft.Data.Sqlite;
using Screenshot.Storage;

// 测试失败只输出明确结果并返回非零退出码，避免未处理异常触发系统诊断界面。
try
{
// 所有快照均为合成数据，存于独立临时目录；不读取应用或用户真实恢复目录。
var testRoot = Path.Combine(Path.GetTempPath(), "Screenshot-storage-tests", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(testRoot);
var passed = 0;
var png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
JsonElement Document(string text, string? image = null) => JsonSerializer.SerializeToElement(new
{
    schemaVersion = 2,
    image = new { dataUrl = image ?? png, name = "synthetic.png", width = 1, height = 1 },
    editor = new { mode = "raw", text, padding = 48, radius = 18, background = "#ffffff", shadow = false, title = "Synthetic", fontSize = 26, textWidth = 720, annotations = Array.Empty<object>(), crop = (object?)null, resize = (object?)null }
});
void Check(bool condition, string description) { if (!condition) throw new Exception("FAIL " + description); passed++; }
async Task Reject(Func<Task> action, string description)
{
    try { await action(); } catch (SnapshotStoreException) { passed++; return; }
    throw new Exception("FAIL " + description);
}

using (var store = new SnapshotStore(Path.Combine(testRoot, "roundtrip")))
{
    var first = await store.SaveAsync("doc-first", 1, Document("original"));
    Check(first.Saved && !first.Stale, "first snapshot saved");
    var entries = await store.ListAsync();
    Check(entries.Count == 1 && entries[0].DocumentId == "doc-first" && entries[0].Revision == 1, "list carries stable document identity and revision");
    var restored = await store.LoadAsync("doc-first");
    Check(restored.Document.GetProperty("image").GetProperty("dataUrl").GetString() == png, "restore embeds original immutable PNG");
    Check(restored.Document.GetProperty("editor").GetProperty("text").GetString() == "original", "restore retains editor fields");
    await store.SaveAsync("doc-second", 1, Document("second document"));
    Check(Directory.GetFiles(Path.Combine(testRoot, "roundtrip", "assets"), "*.png").Length == 1, "different documents deduplicate same image asset");
    var stale = await store.SaveAsync("doc-first", 0, Document("stale"));
    Check(!stale.Saved && stale.Stale, "late lower revision rejected");
    var duplicate = await store.SaveAsync("doc-first", 1, Document("same revision replacement"));
    Check(!duplicate.Saved && duplicate.Stale, "same revision cannot overwrite prior snapshot");
    Check((await store.LoadAsync("doc-first")).Document.GetProperty("editor").GetProperty("text").GetString() == "original", "stale writes do not change current snapshot");
    await Reject(() => store.SaveAsync("../escape", 2, Document("bad identity")), "path-like document identity rejected");
    await Reject(() => store.SaveAsync("remote", 1, Document("remote", "https://example.invalid/private.png")), "remote image asset rejected without request");
    using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    try { await store.SaveAsync("cancelled", 1, Document("cancelled"), cancelled.Token); throw new Exception("FAIL pre-cancelled save accepted"); }
    catch (OperationCanceledException) { passed++; }

    // 使用真实 SQLite trigger 中断事务，证明此前已提交的文档仍可恢复，无需生产测试钩子。
    using (var connection = new SqliteConnection("Data Source=" + Path.Combine(testRoot, "roundtrip", "snapshots.db")))
    {
        connection.Open();
        using var trigger = connection.CreateCommand();
        trigger.CommandText = "CREATE TRIGGER reject_update BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END;";
        trigger.ExecuteNonQuery();
        await Reject(() => store.SaveAsync("doc-first", 2, Document("interrupted")), "interrupted transaction reports failure");
        Check((await store.LoadAsync("doc-first")).Document.GetProperty("editor").GetProperty("text").GetString() == "original", "interrupted transaction preserves committed snapshot");
        trigger.CommandText = "DROP TRIGGER reject_update;"; trigger.ExecuteNonQuery();
    }
    await store.DeleteAsync("doc-second");
    Check((await store.ListAsync()).Count == 1, "explicit delete removes only selected recovery");
}

// 重启后恢复不依赖服务对象内存，资产被改写后必须检出，不能返回被篡改的像素。
using (var restarted = new SnapshotStore(Path.Combine(testRoot, "roundtrip")))
{
    Check((await restarted.LoadAsync("doc-first")).Revision == 1, "new service restores persisted revision");
    var asset = Directory.GetFiles(Path.Combine(testRoot, "roundtrip", "assets"), "*.png").Single();
    await File.WriteAllTextAsync(asset, "synthetic corruption");
    await Reject(() => restarted.LoadAsync("doc-first"), "asset corruption detected before restoring document");
}

using (var limited = new SnapshotStore(Path.Combine(testRoot, "bounded"), new SnapshotStoreOptions(MaxDocuments: 2, MaxAssetBytes: 1024 * 1024)))
{
    await limited.SaveAsync("doc-a", 1, Document("a"));
    await limited.SaveAsync("doc-b", 1, Document("b"));
    await limited.SaveAsync("doc-c", 1, Document("c"));
    var recent = await limited.ListAsync();
    Check(recent.Count == 2 && recent.Any(item => item.DocumentId == "doc-c"), "capacity prunes old documents while retaining newest save");
}
// 版本兼容、数据库中移除 base64，以及跨实例乱序保存均用真实 SQLite 检查。
var invariantRoot = Path.Combine(testRoot, "invariants");
using (var store = new SnapshotStore(invariantRoot))
{
    var schema1 = JsonSerializer.SerializeToElement(new { schemaVersion = 1, image = (object?)null, editor = new { mode = "reflow", text = "synthetic schema one" } });
    await store.SaveAsync("schema-one", 1, schema1);
    var restored = await store.LoadAsync("schema-one");
    Check(restored.Document.GetProperty("schemaVersion").GetInt32() == 1 && restored.Document.GetProperty("image").ValueKind == JsonValueKind.Null, "schema one and text-only document restored");
    await store.SaveAsync("same-document", 1, Document("revision one"));
    using (var other = new SnapshotStore(invariantRoot))
    {
        await Task.WhenAll(store.SaveAsync("same-document", 2, Document("revision two")), other.SaveAsync("same-document", 3, Document("revision three")));
        var latest = await store.LoadAsync("same-document");
        Check(latest.Revision == 3 && latest.Document.GetProperty("editor").GetProperty("text").GetString() == "revision three", "cross-instance unordered saves retain greatest revision");
    }
    using var connection = new SqliteConnection("Data Source=" + Path.Combine(invariantRoot, "snapshots.db")); connection.Open();
    using var query = connection.CreateCommand(); query.CommandText = "PRAGMA journal_mode;";
    Check((string?)query.ExecuteScalar() == "wal", "SQLite uses write-ahead logging");
    query.CommandText = "SELECT document_json FROM snapshots WHERE document_id='same-document';";
    var storedJson = (string)query.ExecuteScalar()!;
    Check(!storedJson.Contains("data:image/") && !storedJson.Contains("iVBOR"), "SQLite document excludes immutable image base64");
    await Reject(() => store.LoadAsync("missing-document"), "missing recovery is an explicit exception");

    // 持真实写事务阻塞保存，取消后释放锁，原记录应仍完整且没有提交较新修订。
    using (var held = connection.BeginTransaction())
    {
        using var cts = new CancellationTokenSource(); cts.CancelAfter(20);
        var pending = store.SaveAsync("same-document", 4, Document("cancelled while locked"), cts.Token);
        await Task.Delay(80); held.Rollback();
        try { await pending; throw new Exception("FAIL cancelled locked save committed"); }
        catch (OperationCanceledException) { passed++; }
    }
    Check((await store.LoadAsync("same-document")).Revision == 3, "cancellation while SQLite locked preserves committed revision");
    using var cancelledDelete = new CancellationTokenSource(); cancelledDelete.Cancel();
    try { await store.DeleteAsync("same-document", cancelledDelete.Token); throw new Exception("FAIL pre-cancelled delete accepted"); }
    catch (OperationCanceledException) { passed++; }
    Check((await store.LoadAsync("same-document")).Revision == 3, "cancelled deletion retains recovery");
}

// 构造带合法 tEXt 附加块的合成 PNG，验证字节去重与容量按唯一原图计算。
var variant = AddSyntheticTextChunk(png);
var firstBytes = Convert.FromBase64String(png[(png.IndexOf(',') + 1)..]).LongLength;
var secondBytes = Convert.FromBase64String(variant[(variant.IndexOf(',') + 1)..]).LongLength;
var quotaRoot = Path.Combine(testRoot, "asset-quota");
using (var quota = new SnapshotStore(quotaRoot, new SnapshotStoreOptions(MaxDocuments: 20, MaxAssetBytes: Math.Max(firstBytes, secondBytes))))
{
    await quota.SaveAsync("old", 1, Document("old"));
    var marker = Path.Combine(quotaRoot, "assets", "keep-synthetic-marker.txt"); await File.WriteAllTextAsync(marker, "synthetic marker");
    await quota.SaveAsync("new", 1, Document("new", variant));
    var entries = await quota.ListAsync();
    Check(entries.Count == 1 && entries[0].DocumentId == "new", "asset byte quota evicts old reference and retains new snapshot");
    Check(Directory.GetFiles(Path.Combine(quotaRoot, "assets"), "*.png").Length == 1, "unreferenced old original collected after quota transaction");
    Check(File.Exists(marker), "garbage collection preserves unrelated files");
    Check((await quota.LoadAsync("new")).Document.GetProperty("image").GetProperty("dataUrl").GetString() == variant, "quota retains exact newly committed immutable bytes");
    await Reject(() => quota.SaveAsync("oversized", 1, Document("too large", AddSyntheticTextChunk(variant))), "single oversized asset cannot evict committed snapshots");
    Check((await quota.LoadAsync("new")).Revision == 1, "capacity rejection retains existing snapshot");
}

// 新资产已落盘后由 SQLite trigger 制造失败，孤立新图应清理，旧原图保持可恢复。
var rollbackRoot = Path.Combine(testRoot, "new-asset-rollback");
using (var store = new SnapshotStore(rollbackRoot))
{
    await store.SaveAsync("document", 1, Document("committed"));
    using var connection = new SqliteConnection("Data Source=" + Path.Combine(rollbackRoot, "snapshots.db")); connection.Open();
    using var trigger = connection.CreateCommand();
    trigger.CommandText = "CREATE TRIGGER reject_asset_update BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'synthetic secret SQL detail'); END;"; trigger.ExecuteNonQuery();
    try { await store.SaveAsync("document", 2, Document("uncommitted", variant)); throw new Exception("FAIL interrupted new asset committed"); }
    catch (SnapshotStoreException error) { Check(!error.Message.Contains("synthetic secret") && !error.Message.Contains(rollbackRoot), "failure does not expose raw SQL or paths"); }
    Check((await store.LoadAsync("document")).Document.GetProperty("editor").GetProperty("text").GetString() == "committed", "new-asset transaction failure preserves old JSON");
    Check(Directory.GetFiles(Path.Combine(rollbackRoot, "assets"), "*.png").Length == 1, "failed transaction collects orphan new asset without removing referenced original");
    trigger.CommandText = "DROP TRIGGER reject_asset_update;"; trigger.ExecuteNonQuery();

    // 模拟崩溃遗留的未引用文件被其他进程占用；保存成功与清理暂缓必须分别报告。
    if (OperatingSystem.IsWindows())
    {
        var orphan = Path.Combine(rollbackRoot, "assets", new string('a', 64) + ".png"); await File.WriteAllBytesAsync(orphan, new byte[] { 1, 2, 3 });
        using (var locked = new FileStream(orphan, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var saved = await store.SaveAsync("document", 2, Document("saved while orphan locked"));
            Check(saved.Saved && saved.CleanupPending, "committed save reports deferred cleanup instead of failure");
        }
        var retry = await store.SaveAsync("document", 3, Document("cleanup retry"));
        Check(retry.Saved && !retry.CleanupPending && !File.Exists(orphan), "later transaction safely retries orphan cleanup");
    }
    var safeNameDocument = JsonSerializer.SerializeToElement(new { schemaVersion = 2, image = new { dataUrl = png, name = "C:\\synthetic-only\\example.png\n", width = 1, height = 1 }, editor = new { mode = "raw", text = "synthetic" } });
    await store.SaveAsync("safe-name", 1, safeNameDocument);
    Check((await store.ListAsync()).Single(item => item.DocumentId == "safe-name").Name == "example.png", "list name removes directory and control characters");
    Check(Directory.GetFiles(Path.Combine(rollbackRoot, "assets"), "*.tmp").Length == 0, "atomic asset writes leave no temporary file after completion");
}
SqliteConnection.ClearAllPools();
Console.WriteLine($"PASS {passed} SQLite immutable asset, revision, interruption, restart, corruption and capacity checks");
Console.WriteLine("Synthetic evidence directory: " + testRoot);
}
catch (Exception error)
{
    Console.Error.WriteLine($"FAIL Storage runner: {error.GetType().Name}: {error.Message}");
    Environment.ExitCode = 1;
}

// 在 IEND 前插入合法 tEXt 块并计算 PNG CRC，不用图形界面生成不同的原图字节。
static string AddSyntheticTextChunk(string dataUrl)
{
    var original = Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]);
    var payload = Encoding.UTF8.GetBytes("Comment\0synthetic storage variant");
    var chunk = new byte[12 + payload.Length]; BinaryPrimitives.WriteInt32BigEndian(chunk.AsSpan(0,4), payload.Length);
    "tEXt"u8.CopyTo(chunk.AsSpan(4,4)); payload.CopyTo(chunk,8);
    uint crc = 0xffffffff;
    foreach (var value in chunk.AsSpan(4,4 + payload.Length))
    {
        crc ^= value;
        for (int bit = 0; bit < 8; bit++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xedb88320 : crc >> 1;
    }
    BinaryPrimitives.WriteUInt32BigEndian(chunk.AsSpan(8 + payload.Length,4), crc ^ 0xffffffff);
    var combined = new byte[original.Length + chunk.Length];
    original.AsSpan(0,original.Length - 12).CopyTo(combined); chunk.CopyTo(combined,original.Length - 12);
    original.AsSpan(original.Length - 12).CopyTo(combined.AsSpan(combined.Length - 12));
    return "data:image/png;base64," + Convert.ToBase64String(combined);
}
