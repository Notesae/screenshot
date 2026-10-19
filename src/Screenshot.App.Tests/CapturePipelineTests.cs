using Screenshot.App;
using System.Text.Json;

// 只使用假帧、数组和取消令牌，不加载 WinRT、D3D 或任何真实捕获后端。
internal static class CapturePipelineTests
{
    // 覆盖请求校验、资源归还顺序、取帧取消、几何组合和错误分类的确定性回归。
    public static async Task<int> RunAsync()
    {
        var checks = 0;
        void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }
        CaptureRequest Request(string json)
        {
            using var document = JsonDocument.Parse(json);
            return CaptureRequest.Parse(document.RootElement, true);
        }
        void Reject(Action action, string code)
        {
            try { action(); } catch (CaptureException e) when (e.Code == code) { checks++; return; }
            throw new Exception("expected capture error " + code);
        }
        Check(Request("{}").Backend == "wgc", "default backend is WGC");
        Check(Request("{\"backend\":\"gdi\"}").Backend == "gdi", "GDI requires explicit backend selection");
        var window = Request("{\"target\":{\"kind\":\"window\",\"handle\":\"0x12345\",\"area\":\"client\"}}");
        Check(window.Target.Kind == CaptureTargetKind.Window && window.Target.Handle == 0x12345 && window.Target.ClientArea, "window target retains explicit handle and client area");
        Reject(() => Request("{\"backend\":\"auto\"}"), "invalid_capture_backend");
        Reject(() => Request("{\"target\":{\"kind\":\"monitor\",\"handle\":123}}"), "invalid_capture_request");
        Reject(() => Request("{\"target\":{\"kind\":\"window\",\"handle\":\"0\"}}"), "invalid_capture_target");
        Reject(() => Request("{\"timeoutMs\":\"slow\"}"), "invalid_capture_timeout");
        Reject(() => Request("{\"timeoutMs\":30001}"), "invalid_capture_timeout");
        Check(CaptureErrors.Map(new UnauthorizedAccessException("private OS details"))?.Code == "capture_access_denied", "projected access-denied errors keep stable capture code");
        Check(CaptureErrors.Map(new System.Runtime.InteropServices.COMException("private device details", unchecked((int)0x887A0005)))?.Code == "capture_device_lost", "device removal HRESULT is classified");
        Check(CaptureErrors.Map(new ObjectDisposedException("private resource"))?.Code == "capture_target_closed", "closed WinRT projection is classified");
        Check(CaptureErrors.Map(new PlatformNotSupportedException("private environment"))?.Code == "capture_unsupported", "missing OS capture support is explicit");
        Check(!CaptureErrors.Map(new UnauthorizedAccessException("secret path"))!.Message.Contains("secret path"), "native error details do not leak through public capture message");

        var stale = new FakeFrame(new(3, 2), Pixels(3, 2, 7));
        var fresh = new FakeFrame(new(3, 2), Pixels(3, 2, 11));
        var resized = new FakeSession(new(2, 2), stale, fresh);
        var result = await CaptureFrameReader.ReadAsync(resized, TimeSpan.FromSeconds(1), CancellationToken.None);
        Check(resized.RecreateCount == 1 && stale.CopyCount == 0 && fresh.CopyCount == 1, "resize discards mismatched frame before copying");
        Check(stale.DisposeCount == 1 && fresh.DisposeCount == 1 && resized.DisposeCount == 1, "frame leases and session disposed exactly once");
        Check(result.Bytes[0] == 11 && result.Size == new CaptureSize(3, 2), "only resized frame pixels returned");

        var broken = new FakeFrame(new(2, 2), Pixels(2, 2, 1)) { CopyError = new CaptureException("capture_device_lost", "fake device lost") };
        var failing = new FakeSession(new(2, 2), broken);
        try { await CaptureFrameReader.ReadAsync(failing, TimeSpan.FromSeconds(1), CancellationToken.None); throw new Exception("expected device error"); }
        catch (CaptureException e) when (e.Code == "capture_device_lost") { checks++; }
        Check(broken.DisposeCount == 1 && failing.DisposeCount == 1, "copy failure disposes frame and device session");
        var waiting = new FakeSession(new(2, 2));
        try { await CaptureFrameReader.ReadAsync(waiting, TimeSpan.FromMilliseconds(20), CancellationToken.None); throw new Exception("expected timeout"); }
        catch (CaptureException e) when (e.Code == "capture_timeout") { checks++; }
        Check(waiting.DisposeCount == 1, "timeout closes waiting session");
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        var cancelled = new FakeSession(new(2, 2));
        try { await CaptureFrameReader.ReadAsync(cancelled, TimeSpan.FromSeconds(1), cancellation.Token); throw new Exception("expected cancellation"); }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { checks++; }
        Check(cancelled.DisposeCount == 1 && cancelled.NextCount == 0, "pre-cancel releases session without obtaining a frame");
        using var cancelledDuringCopy = new CancellationTokenSource();
        var copying = new FakeFrame(new(2, 2), Pixels(2, 2, 12)) { OnCopy = cancelledDuringCopy.Cancel };
        var copyingSession = new FakeSession(new(2, 2), copying);
        try { await CaptureFrameReader.ReadAsync(copyingSession, TimeSpan.FromSeconds(1), cancelledDuringCopy.Token); throw new Exception("copy cancellation must not return stale pixels"); }
        catch (OperationCanceledException) when (cancelledDuringCopy.IsCancellationRequested) { checks++; }
        Check(copying.DisposeCount == 1 && copyingSession.DisposeCount == 1, "cancellation observed after copy still releases all leases");

        var left = Pixels(2, 2, 40); var right = Pixels(2, 2, 80);
        var combined = CapturePixelGeometry.Compose(new(-2, -1, 5, 2), new[] { (new PixelRect(-2, -1, 2, 2), left), (new PixelRect(1, -1, 2, 2), right) });
        Check(combined.Bytes[0] == 40 && combined.Bytes[8] == 0 && combined.Bytes[12] == 80, "negative-coordinate monitors compose without scaling and preserve gap");
        var crop = CapturePixelGeometry.Crop(combined, new(3, 0, 2, 2));
        Check(crop.Bytes.All(value => value == 80) && crop.Bytes.Length == 16, "cropped bytes contain only selected monitor pixels");
        Reject(() => CapturePixelGeometry.Crop(combined, new(-1, 0, 2, 2)), "capture_target_outside_desktop");
        Reject(() => new CapturePixels(new(2, 2), new byte[8], 8), "capture_buffer_invalid");
        Reject(() => new CaptureSize(0, 20).Validate(), "capture_size_invalid");

        var platform = new FakePlatform();
        var desktop = await new CaptureAcquisition(platform).AcquireAsync(CaptureRequest.Default(false), CancellationToken.None);
        Check(desktop.DesktopBounds == new PixelRect(-2, 0, 4, 2) && desktop.Selection == desktop.DesktopBounds, "desktop acquisition preserves physical union bounds");
        Check(platform.MonitorCaptures == 2 && platform.WindowCaptures == 0, "desktop acquisition uses only requested backend monitor frames");
        var monitor = await new CaptureAcquisition(new FakePlatform()).AcquireAsync(new("wgc", new(CaptureTargetKind.Monitor, 2), false), CancellationToken.None);
        Check(monitor.Selected.Bytes.All(v => v == 80) && monitor.Selection == new PixelRect(0, 0, 2, 2), "specified monitor returns only that monitor image");
        var windowCapture = await new CaptureAcquisition(new FakePlatform()).AcquireAsync(new("wgc", new(CaptureTargetKind.Window, 99, true), false), CancellationToken.None);
        Check(windowCapture.Selection == new PixelRect(-1, 1, 2, 1) && windowCapture.Selected.Bytes.All(v => v == 90), "client target crops WGC window frame using physical client origin");
        Check(windowCapture.Backdrop.Bytes[0] == 40 && !windowCapture.Backdrop.Bytes.Contains((byte)90), "native desktop context is separate from selected window pixels");
        var moved = new FakePlatform { MoveAfterWindowCapture = true };
        try { await new CaptureAcquisition(moved).AcquireAsync(new("wgc", new(CaptureTargetKind.Window, 99), false), CancellationToken.None); throw new Exception("expected geometry change"); }
        catch (CaptureException e) when (e.Code == "capture_geometry_changed") { checks++; }
        var denied = new FakePlatform { WindowError = new CaptureException("capture_access_denied", "fake permission error") };
        try { await new CaptureAcquisition(denied).AcquireAsync(new("wgc", new(CaptureTargetKind.Window, 99), false), CancellationToken.None); throw new Exception("expected permission error"); }
        catch (CaptureException e) when (e.Code == "capture_access_denied") { checks++; }
        Check(denied.WindowCaptures == 1 && denied.MonitorCaptures == 2, "permission failure does not retry another backend");
        var removed = new FakePlatform();
        try { await new CaptureAcquisition(removed).AcquireAsync(new("wgc", new(CaptureTargetKind.Monitor, 999), false), CancellationToken.None); throw new Exception("expected removed monitor"); }
        catch (CaptureException e) when (e.Code == "capture_target_unavailable") { checks++; }
        Check(removed.MonitorCaptures == 0, "invalid explicit monitor rejected before frame acquisition");
        var movedMonitor = new FakePlatform { FinalMonitors = new[] { new CaptureMonitor(1, new(-4, 0, 2, 2), false), new CaptureMonitor(2, new(0, 0, 2, 2), true) } };
        try { await new CaptureAcquisition(movedMonitor).AcquireAsync(CaptureRequest.Default(false), CancellationToken.None); throw new Exception("monitor position change must invalidate backdrop"); }
        catch (CaptureException e) when (e.Code == "capture_geometry_changed") { checks++; }
        var disconnectedMonitor = new FakePlatform { FinalMonitors = new[] { new CaptureMonitor(2, new(0, 0, 2, 2), true) } };
        try { await new CaptureAcquisition(disconnectedMonitor).AcquireAsync(CaptureRequest.Default(false), CancellationToken.None); throw new Exception("monitor removal must invalidate backdrop"); }
        catch (CaptureException e) when (e.Code == "capture_geometry_changed") { checks++; }
        var replacedMonitor = new FakePlatform { FinalMonitors = new[] { new CaptureMonitor(3, new(-2, 0, 2, 2), false), new CaptureMonitor(2, new(0, 0, 2, 2), true) } };
        try { await new CaptureAcquisition(replacedMonitor).AcquireAsync(CaptureRequest.Default(false), CancellationToken.None); throw new Exception("monitor handle replacement must invalidate backdrop"); }
        catch (CaptureException e) when (e.Code == "capture_geometry_changed") { checks++; }
        var reorderedMonitors = new FakePlatform { FinalMonitors = new[] { new CaptureMonitor(2, new(0, 0, 2, 2), true), new CaptureMonitor(1, new(-2, 0, 2, 2), false) } };
        var reorderedDesktop = await new CaptureAcquisition(reorderedMonitors).AcquireAsync(CaptureRequest.Default(false), CancellationToken.None);
        Check(reorderedDesktop.DesktopBounds == desktop.DesktopBounds && reorderedMonitors.MonitorReads == 2, "layout validation tolerates monitor enumeration order changes");
        return checks;
    }

    private static CapturePixels Pixels(int width, int height, byte value) => new(new(width, height), Enumerable.Repeat(value, width * height * 4).ToArray(), width * 4);

    // 显式记录释放与复制次数，避免 mock 只验证方法名字而漏掉资源顺序。
    private sealed class FakeFrame(CaptureSize size, CapturePixels pixels) : ICaptureFrameLease
    {
        public CaptureSize ContentSize => size;
        public int CopyCount { get; private set; }
        public int DisposeCount { get; private set; }
        public Exception? CopyError { get; init; }
        public Action? OnCopy { get; init; }
        public Task<CapturePixels> CopyPixelsAsync(CancellationToken token)
        {
            token.ThrowIfCancellationRequested(); CopyCount++; OnCopy?.Invoke();
            return CopyError is null ? Task.FromResult(pixels) : Task.FromException<CapturePixels>(CopyError);
        }
        public void Dispose() => DisposeCount++;
    }

    // resize 必须发生在旧帧已归还之后；无帧时仅等待测试自己的取消令牌。
    private sealed class FakeSession(CaptureSize initial, params FakeFrame[] frames) : ICaptureFrameSession
    {
        private readonly Queue<FakeFrame> _frames = new(frames);
        private FakeFrame? _last;
        public CaptureSize BufferSize { get; private set; } = initial;
        public int RecreateCount { get; private set; }
        public int DisposeCount { get; private set; }
        public int NextCount { get; private set; }
        public async Task<ICaptureFrameLease> NextFrameAsync(CancellationToken token)
        {
            NextCount++;
            if (_frames.TryDequeue(out var next)) { _last = next; return next; }
            await Task.Delay(Timeout.Infinite, token);
            throw new InvalidOperationException("unreachable fake frame source");
        }
        public void Recreate(CaptureSize size)
        {
            if (_last?.DisposeCount != 1) throw new Exception("old frame must be disposed before resize");
            BufferSize = size; RecreateCount++;
        }
        public void Dispose() => DisposeCount++;
    }

    // 假平台只返回预先构造的像素和几何，不调用显示器枚举或 HWND API。
    private sealed class FakePlatform : ICapturePlatform
    {
        public bool MoveAfterWindowCapture { get; init; }
        public CaptureException? WindowError { get; init; }
        public int MonitorCaptures { get; private set; }
        public int WindowCaptures { get; private set; }
        public int MonitorReads { get; private set; }
        public IReadOnlyList<CaptureMonitor>? FinalMonitors { get; init; }
        public IReadOnlyList<CaptureMonitor> GetMonitors()
        {
            MonitorReads++;
            return MonitorReads > 1 && FinalMonitors is not null ? FinalMonitors
                : new[] { new CaptureMonitor(1, new(-2, 0, 2, 2), false), new CaptureMonitor(2, new(0, 0, 2, 2), true) };
        }
        public PixelRect GetWindowBounds(nint handle, bool clientArea) => new(-1 + (MoveAfterWindowCapture && WindowCaptures > 0 ? 1 : 0), clientArea ? 1 : 0, 2, clientArea ? 1 : 2);
        public Task<CapturePixels> CaptureItemAsync(CaptureTargetKind kind, nint handle, int timeoutMs, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (kind == CaptureTargetKind.Window)
            {
                WindowCaptures++;
                return WindowError is null ? Task.FromResult(Pixels(2, 2, 90)) : Task.FromException<CapturePixels>(WindowError);
            }
            MonitorCaptures++;
            return Task.FromResult(Pixels(2, 2, handle == 1 ? (byte)40 : (byte)80));
        }
    }
}
