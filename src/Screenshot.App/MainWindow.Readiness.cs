using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace Screenshot.App;

public partial class MainWindow
{
    private string? _paintCaptureId;
    private Task<object>? _paintInFlight;
    private string? _compositionRecoveryCaptureId; // 同一捕获最多重新激活一次合成，避免失败时反复隐藏控件。
    private bool IsCaptureReady(string id) => _presentation.Mode == PresentationMode.Overlay && _presentation.Matches(id) && _presentation.PendingCaptureId is null;

    // 全透明帧超时才重新激活 SDK 的可见性路径；原生遮挡仍在，WebView 和内存文档不重载。
    private async Task<bool> RecoverCaptureCompositionAsync(string captureId)
    {
        if (_compositionRecoveryCaptureId == captureId || !_presentation.IsPrepared(captureId) || _captureHandoff.IsCancelled(captureId)
            || _lifetime.IsCancellationRequested || !IsVisible || Editor.Visibility != Visibility.Visible) return false;
        _compositionRecoveryCaptureId = captureId;
        var trace = _captureDiagnostics?.CaptureId == captureId ? _captureDiagnostics : null;
        trace?.Mark("composition_recovery_started");
        Editor.SetCurrentValue(UIElement.VisibilityProperty, Visibility.Hidden);
        try { await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded, _lifetime.Token); }
        finally { Editor.SetCurrentValue(UIElement.VisibilityProperty, Visibility.Visible); }
        if (!_presentation.IsPrepared(captureId) || _captureHandoff.IsCancelled(captureId)) return false;
        trace?.Mark("composition_recovery_requested");
        return true;
    }

    // 相同捕获的重试共享一次验帧，避免丢失回执后并行创建多个合成确认器。
    private Task<object> PaintedPresentationAsync(string captureId, PresentationViewport viewport)
    {
        if (_paintCaptureId == captureId && _paintInFlight is { IsCompleted: false }) return _paintInFlight;
        var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        _paintCaptureId = captureId; _paintInFlight = completion.Task;
        _ = RunPaintFlightAsync(captureId, viewport, completion);
        return completion.Task;
    }
    private async Task RunPaintFlightAsync(string id, PresentationViewport viewport, TaskCompletionSource<object> completion)
    {
        var trace = _captureDiagnostics?.CaptureId == id ? _captureDiagnostics : null;
        try { completion.TrySetResult(await PaintedPresentationCoreAsync(id, viewport)); }
        catch (OperationCanceledException error) { completion.TrySetCanceled(error.CancellationToken); }
        catch (TimeoutException)
        {
            trace?.Fail("present_finalize_timeout");
            completion.TrySetResult(new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted = false,
                awaitingPaint = _presentation.IsPrepared(id), captureId = _presentation.Overlay?.CaptureId });
        }
        catch (Exception error) { trace?.Fail("host_paint_error", new { errorType = error.GetType().Name }); completion.TrySetException(error); }
        finally { if (ReferenceEquals(_paintInFlight, completion.Task)) { _paintInFlight = null; _paintCaptureId = null; } }
    }

    // 前端只可上报固定阶段和有限几何值；不接受日志正文、图片、错误堆栈或服务配置。
    private object RecordCaptureProgress(JsonElement payload)
    {
        var id = RequiredString(payload, "captureId");
        if (_captureDiagnostics is not { } trace || trace.CaptureId != id || _presentation.Overlay?.CaptureId != id) return new { accepted = false };
        var phase = RequiredString(payload, "phase");
        if (phase is not ("received" or "decoded" or "document_committed" or "canvas_ready" or "viewport_wait" or "bridge_retry" or "ready_confirmed" or "layout_timeout" or "image_error" or "canvas_error" or "ready_error"))
            throw new InvalidOperationException("选区诊断阶段无效。");
        PresentationViewport? viewport = null;
        if (payload.TryGetProperty("viewport", out var value))
        {
            viewport = new(value.GetProperty("width").GetDouble(), value.GetProperty("height").GetDouble(), value.GetProperty("scale").GetDouble());
            if (!viewport.Matches(viewport)) throw new InvalidOperationException("选区诊断尺寸无效。");
        }
        if (phase is "layout_timeout" or "image_error" or "canvas_error" or "ready_error") trace.Fail("editor_" + phase, new { viewport });
        else { trace.Mark("editor_" + phase, details: new { viewport }); trace.Flush(); }
        return new { accepted = true };
    }
}
