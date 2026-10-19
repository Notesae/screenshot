using Screenshot.App;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// 失败以控制台退出码报告，避免未处理异常触发系统错误对话框。
try
{
// 以无外部依赖的断言验证原生信任边界、像素保真和请求并发契约。
var checks = 0;
void Check(bool condition, string label) { if (!condition) throw new Exception(label); checks++; }
Check(BridgePolicy.IsTrustedSource("https://app.screenshot.local/"), "local origin accepted");
Check(BridgePolicy.IsTrustedSource("https://app.screenshot.local/index.html"), "local document accepted");
foreach (var uri in new[] { "http://app.screenshot.local/", "https://app.screenshot.local.evil/", "https://app.screenshot.local:444/", "file:///index.html", "https://user@app.screenshot.local/", "javascript:alert(1)" })
    Check(!BridgePolicy.IsTrustedSource(uri), $"untrusted source rejected: {uri}");
var rect = CaptureGeometry.Selection(-100, 40, -160, 10, new PixelRect(-1920, 0, 3840, 1080));
Check(rect == new PixelRect(-160, 10, 60, 30), "negative-coordinate reverse selection preserved");
rect = CaptureGeometry.Selection(-3000, -10, 5000, 1200, new PixelRect(-1920, 0, 3840, 1080));
Check(rect == new PixelRect(-1920, 0, 3840, 1080), "selection clipped to virtual screen");
Check(CaptureGeometry.Selection(1, 1, 1, 1, new PixelRect(0, 0, 100, 100)).Width == 0, "zero area selection is empty");
Check(BridgePolicy.SafeName("../test.png", "capture.png") == "test.png", "suggested names cannot navigate directories");
void Reject(Action action, string label)
{
    try { action(); } catch (Exception e) when (e is InvalidOperationException or FormatException or NotSupportedException) { checks++; return; }
    throw new Exception(label);
}
var pixels = new byte[] { 0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0, 255, 0, 0, 0, 0 };
var original = BitmapSource.Create(2, 2, 96, 96, PixelFormats.Bgra32, null, pixels, 8);
var loaded = NativeImages.FromBitmap(original, "synthetic.png");
Check(loaded.Width == 2 && loaded.Height == 2, "PNG dimensions preserved");
var decoded = NativeImages.DecodePng(loaded.DataUrl);
var restored = new byte[16]; decoded.CopyPixels(restored, 8, 0);
Check(pixels.SequenceEqual(restored), "PNG pixel and alpha values preserved");
foreach (var invalid in new[] { "https://example.com/image.png", "data:image/png;base64,dGVzdA==", "data:image/jpeg;base64,AAAA" })
    Reject(() => NativeImages.DecodePng(invalid), "malformed or remote image must be rejected");
// 直接校验项目数据，不弹出原生文件对话框。
void Project(string json)
{
    using var document = JsonDocument.Parse(json);
    NativeImages.ValidateProject(document.RootElement);
}
Project("{\"schemaVersion\":1,\"image\":null,\"editor\":{}}"); checks++;
Project("{\"schemaVersion\":2,\"image\":null,\"editor\":{}}"); checks++;
Reject(() => Project("{\"schemaVersion\":3,\"image\":null,\"editor\":{}}"), "unknown schema rejected");
Reject(() => Project("{\"schemaVersion\":1,\"image\":{\"dataUrl\":\"https://example.com/image.png\"},\"editor\":{}}"), "remote project image rejected");
Reject(() => Project("{\"schemaVersion\":1,\"editor\":{}}"), "missing project image field rejected");
// 模拟长时间 AI 请求，确认本地流程独立可用且同类操作仍不能重入。
var gate = new RequestGate();
Check(gate.TryEnter("ai.ocr", out var ocr), "first AI request accepted");
Check(!gate.TryEnter("ai.translate", out _), "second AI request rejected");
Check(gate.TryEnter("image.save", out var save), "save accepted while AI is running");
Check(!gate.TryEnter("capture.region", out _), "capture rejected while native dialog is active");
foreach (var method in new[] { "app.info", "settings.read", "presentation.ready", "presentation.workbench", "presentation.dismiss" })
    Check(gate.TryEnter(method, out var read) && read is null, "pure read accepted while both operation lanes are busy");
save!.Dispose();
Check(gate.TryEnter("image.copy", out var copy), "copy accepted while AI is still running");
save.Dispose();
Check(!gate.TryEnter("image.open", out _), "disposing a prior lease twice does not release another operation");
copy!.Dispose();
Check(gate.TryEnter("image.open", out var open), "new image import accepted while AI is still running");
open!.Dispose(); ocr!.Dispose();
Check(gate.TryEnter("ai.translate", out var translate), "AI lane released after completion");
Check(gate.TryEnter("capture.region", out var capture), "native capture and AI may coexist");
capture!.Dispose(); translate!.Dispose();
// 本地 OCR 与 HTTP AI 共享重任务门控，状态、取消和自身串行的恢复服务无需占原生门控。
Check(gate.TryEnter("ocr.local", out var localOcr), "local OCR acquires AI lane");
Check(!gate.TryEnter("ai.ocr", out _) && !gate.TryEnter("ai.translate", out _), "local OCR blocks concurrent HTTP AI tasks");
Check(gate.TryEnter("image.save", out var nativeDuringOcr), "local save remains available during local OCR");
foreach (var method in new[] { "ocr.status", "ocr.cancel", "capture.settings", "capture.configure", "recovery.save", "recovery.list", "recovery.load", "recovery.delete" })
    Check(gate.TryEnter(method, out var bypass) && bypass is null, "status cancel and queued services bypass busy native and AI lanes: " + method);
nativeDuringOcr!.Dispose(); localOcr!.Dispose();
Check(gate.TryEnter("ai.translate", out var httpAi) && !gate.TryEnter("ocr.local", out _), "HTTP AI prevents simultaneous local OCR");
httpAi!.Dispose();
// 全部覆盖层生命周期检查使用合成像素，不实例化窗口、不访问桌面或剪贴板。
var desktopPixels = new byte[4 * 2 * 4];
var backdrop = BitmapSource.Create(4, 2, 96, 96, PixelFormats.Bgra32, null, desktopPixels, 16);
backdrop.Freeze();
var desktopBounds = new PixelRect(-2, -1, 4, 2);
var selection = new PixelRect(-1, -1, 2, 2);
var frame = new CapturedFrame(loaded, backdrop, desktopBounds, selection,
    new[] { new CaptureScreen(new PixelRect(-2, -1, 2, 2), false), new CaptureScreen(new PixelRect(0, -1, 2, 2), true) });
var presentation = new CapturePresentationState();
Check(presentation.Mode == PresentationMode.Workbench && presentation.FrozenBackdrop is null, "initial workbench has no desktop frame");
presentation.BeginCapture(); presentation.CancelCapture();
Check(presentation.Mode == PresentationMode.Workbench && presentation.FrozenBackdrop is null, "cancelled first selection preserves workbench");
presentation.BeginCapture(); presentation.CompleteCapture(frame);
Check(presentation.Mode == PresentationMode.Overlay && ReferenceEquals(presentation.FrozenBackdrop, backdrop), "capture defaults to native frozen overlay");
Check(!presentation.TryAcceptReady("stale-id"), "stale layout acknowledgement cannot show current capture");
Check(presentation.TryAcceptReady(frame.CaptureId), "current layout acknowledgement accepted once");
Check(!presentation.TryAcceptReady(frame.CaptureId), "duplicate acknowledgement ignored");
presentation.BeginCapture(); presentation.CancelCapture();
Check(presentation.Mode == PresentationMode.Overlay && ReferenceEquals(presentation.FrozenBackdrop, backdrop), "cancelled selection preserves previous overlay and backdrop");
var envelope = frame.ToEnvelope();
Check(envelope.Overlay.DesktopBounds == desktopBounds && envelope.Overlay.Selection == selection, "envelope preserves absolute negative desktop and selection coordinates");
Check(envelope.Overlay.Screens.Count == 2 && envelope.Overlay.Screens[1].Primary, "screen metadata retains per-screen physical geometry");
using (var envelopeJson = JsonDocument.Parse(JsonSerializer.Serialize(envelope, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })))
{
    Check(envelopeJson.RootElement.EnumerateObject().Select(p => p.Name).Order().SequenceEqual(new[] { "image", "overlay" }), "bridge envelope excludes frozen desktop pixels");
    Check(envelopeJson.RootElement.GetProperty("image").GetProperty("dataUrl").GetString() == loaded.DataUrl, "only selected image bytes cross bridge");
}
presentation.ShowWorkbench();
Check(presentation.Mode == PresentationMode.Workbench && presentation.FrozenBackdrop is null && presentation.Overlay is null, "advanced workbench releases desktop backdrop");
Check(!presentation.TryAcceptReady(frame.CaptureId), "late ready cannot reopen workbench as overlay");
presentation.BeginCapture(); presentation.CompleteCapture(frame); presentation.Dismiss();
Check(presentation.Mode == PresentationMode.Hidden && presentation.FrozenBackdrop is null, "dismiss hides presentation and releases desktop backdrop");
Check(!presentation.TryAcceptReady(frame.CaptureId), "late ready cannot reopen dismissed capture");
presentation.BeginCapture(); presentation.CancelCapture();
Check(presentation.Mode == PresentationMode.Hidden && presentation.FrozenBackdrop is null, "cancel from dismissed state stays hidden");
presentation.BeginCapture(); presentation.CompleteCapture(frame);
var newerFrame = frame with { Image = loaded with { Name = "newer.png" } };
// 新捕获实例需有独立身份，不能沿用旧 record 的 with 副本身份。
newerFrame = new CapturedFrame(newerFrame.Image, backdrop, desktopBounds, selection, frame.Screens);
presentation.BeginCapture();
Check(!presentation.TryAcceptReady(frame.CaptureId), "ready cannot reveal a frame while a new selection is active");
presentation.CompleteCapture(newerFrame);
Check(!presentation.TryAcceptReady(frame.CaptureId) && presentation.TryAcceptReady(newerFrame.CaptureId), "capture identity rejects A acknowledgement after B replaces it");
presentation.BeginCapture(); presentation.Dismiss();
Check(!presentation.CompleteCapture(frame) && presentation.Mode == PresentationMode.Hidden, "explicit dismissal invalidates in-flight capture completion");
presentation.BeginCapture(); presentation.CompleteCapture(frame);
Check(!presentation.TryExpireReady("other-capture"), "stale timeout cannot expire current pending frame");
presentation.BeginCapture();
Check(!presentation.TryExpireReady(frame.CaptureId), "ready timeout defers while selecting a new region");
presentation.CancelCapture();
Check(presentation.TryExpireReady(frame.CaptureId) && presentation.Mode == PresentationMode.Workbench && presentation.FrozenBackdrop is null, "unready timeout recovers workbench and releases frozen desktop");
Check(!presentation.TryAcceptReady(frame.CaptureId), "acknowledgement arriving after timeout cannot show overlay");
presentation.BeginCapture(); presentation.CompleteCapture(newerFrame); presentation.TryAcceptReady(newerFrame.CaptureId);
Check(!presentation.TryExpireReady(newerFrame.CaptureId), "completed acknowledgement cancels its timeout state");
Check(!presentation.TryShowWorkbench(frame.CaptureId) && presentation.Overlay?.CaptureId == newerFrame.CaptureId && ReferenceEquals(presentation.FrozenBackdrop, backdrop), "A workbench request cannot clear B overlay or backdrop");
presentation.BeginCapture();
Check(!presentation.TryShowWorkbench(newerFrame.CaptureId) && presentation.IsSelecting, "guarded workbench request cannot interrupt an active selection");
presentation.CancelCapture();
Check(presentation.TryShowWorkbench(newerFrame.CaptureId) && presentation.Mode == PresentationMode.Workbench && presentation.FrozenBackdrop is null, "matching workbench request releases only its own capture");
Check(!presentation.TryShowWorkbench(newerFrame.CaptureId), "guarded workbench request without current overlay is rejected");
presentation.BeginCapture(); presentation.CompleteCapture(frame);
Check(!presentation.TryShowWorkbench(null) && presentation.Mode == PresentationMode.Overlay, "unscoped workbench request cannot clear active capture");
presentation.ShowWorkbench();
Check(presentation.TryShowWorkbench(null) && presentation.Mode == PresentationMode.Workbench, "unscoped workbench request allowed outside overlay");
presentation.BeginCapture();
Check(!presentation.TryShowWorkbench(null) && presentation.IsSelecting, "unscoped workbench request cannot interrupt selection");
presentation.CancelCapture();
presentation.BeginCapture(); presentation.CompleteCapture(newerFrame);
Check(!presentation.TryDismiss(null) && presentation.Mode == PresentationMode.Overlay, "unscoped dismiss cannot hide active capture");
Check(!presentation.TryDismiss(frame.CaptureId) && presentation.Overlay?.CaptureId == newerFrame.CaptureId, "old dismiss request cannot hide newer capture");
presentation.BeginCapture();
Check(!presentation.TryDismiss(null) && presentation.IsSelecting, "unscoped dismiss cannot interrupt selection");
Check(!presentation.TryDismiss(newerFrame.CaptureId) && presentation.IsSelecting, "guarded dismiss cannot interrupt a new selection");
presentation.CancelCapture();
Check(presentation.TryDismiss(newerFrame.CaptureId) && presentation.Mode == PresentationMode.Hidden && presentation.FrozenBackdrop is null, "matching dismiss releases its frame");
Check(presentation.TryDismiss(null) && presentation.Mode == PresentationMode.Hidden, "unscoped dismiss allowed when already hidden");
var adjusted = OverlayWindowGeometry.FitClient(new PixelRect(-1920, -240, 3840, 1440), new PixelRect(-1920, -240, 3840, 1440), new PixelRect(-1912, -232, 3824, 1424));
Check(adjusted == new PixelRect(-1928, -248, 3856, 1456), "physical client alignment accounts for borders without applying a screen DPI");
checks += await CapturePipelineTests.RunAsync();
Console.WriteLine($"PASS {checks} native boundary, PNG roundtrip, capture geometry, request concurrency, overlay lifecycle and fake-frame capture checks");
}
catch (Exception exception)
{
    Console.Error.WriteLine("FAIL " + exception.Message);
    Environment.ExitCode = 1;
}
