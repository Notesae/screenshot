using Screenshot.App;
using System.IO;

// 只控制假关闭任务，不构造窗口、Popup 或调用原生输入。
internal static class NativeNoticeSequenceTests
{
    public static int Run() => RunAsync().GetAwaiter().GetResult();
    private static async Task<int> RunAsync()
    {
        var checks = 0;
        void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }
        var sequence = new NativeNoticeSequence(); var shown = new List<string>();
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = sequence.ReplaceAsync(() => closed.Task, () => shown.Add("first"));
        Check(shown.Count == 0 && !first.IsCompleted, "replacement waits for actual old notice close");
        var latest = sequence.ReplaceAsync(() => closed.Task, () => shown.Add("latest"));
        closed.SetResult();
        Check(!await first && await latest && shown.SequenceEqual(new[] { "latest" }), "rapid notices coalesce while old surface exits");
        var cancelledClose = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var pending = sequence.ReplaceAsync(() => cancelledClose.Task, () => shown.Add("stale"));
        sequence.Cancel(); cancelledClose.SetResult();
        Check(!await pending && shown.Count == 1, "capture invalidates queued notice before taking frozen frame");
        Check(await sequence.ReplaceAsync(() => Task.CompletedTask, () => shown.Add("fresh")) && shown.Count == 2, "later notice is allowed after cancellation");
        try { await sequence.ReplaceAsync(() => Task.FromException(new IOException("synthetic close failure")), () => shown.Add("failed")); throw new Exception("failure was swallowed"); }
        catch (IOException) { Check(shown.Count == 2, "failed close cannot show overlapping replacement"); }
        return checks;
    }
}
