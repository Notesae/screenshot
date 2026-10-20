using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App;

// 目标解析与取帧可替换为假平台；核心组合逻辑不接触 HWND、显示器或图形设备。
internal sealed record CaptureMonitor(nint Handle, PixelRect Bounds, bool Primary, PixelRect? WorkArea = null);
internal interface ICapturePlatform
{
    IReadOnlyList<CaptureMonitor> GetMonitors();
    PixelRect GetWindowBounds(nint handle, bool clientArea);
    Task<CapturePixels> CaptureItemAsync(CaptureTargetKind kind, nint handle, int timeoutMs, CancellationToken token);
}
internal sealed record AcquiredCapture(CapturePixels Backdrop, CapturePixels Selected, PixelRect DesktopBounds, PixelRect Selection, IReadOnlyList<CaptureScreen> Screens);

// 所有底图来自同一 WGC 后端；显示器逐一取帧，不宣称不同显示器是同一时刻。
internal sealed class CaptureAcquisition(ICapturePlatform platform)
{
    // 在同一总期限内获取 WGC 底图与目标像素，最终重新核对窗口与显示器几何。
    public async Task<AcquiredCapture> AcquireAsync(CaptureRequest request, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(request.TimeoutMs);
        try
        {
            token.ThrowIfCancellationRequested();
            var monitors = platform.GetMonitors().ToArray();
            if (monitors.Length == 0) throw new CaptureException("capture_target_unavailable", "没有可捕获的显示器。");
            var left = monitors.Min(m => m.Bounds.X); var top = monitors.Min(m => m.Bounds.Y);
            var right = monitors.Max(m => checked(m.Bounds.X + m.Bounds.Width)); var bottom = monitors.Max(m => checked(m.Bounds.Y + m.Bounds.Height));
            var desktop = new PixelRect(left, top, checked(right - left), checked(bottom - top));
            new CaptureSize(desktop.Width, desktop.Height).Validate();
            if (request.Target.Kind == CaptureTargetKind.Monitor && !monitors.Any(m => m.Handle == request.Target.Handle))
                throw new CaptureException("capture_target_unavailable", "指定显示器已移除或句柄无效。");
            var frames = new List<(PixelRect Bounds, CapturePixels Pixels)>();
            foreach (var monitor in monitors)
            {
                deadline.Token.ThrowIfCancellationRequested();
                var pixels = await platform.CaptureItemAsync(CaptureTargetKind.Monitor, monitor.Handle, request.TimeoutMs, deadline.Token).ConfigureAwait(false);
                frames.Add((monitor.Bounds, pixels));
            }
            var backdrop = CapturePixelGeometry.Compose(desktop, frames);
            var selected = backdrop; var selection = desktop;
            if (request.Target.Kind == CaptureTargetKind.Monitor)
            {
                var monitor = monitors.FirstOrDefault(m => m.Handle == request.Target.Handle)
                    ?? throw new CaptureException("capture_target_unavailable", "指定显示器已移除或句柄无效。");
                selection = monitor.Bounds;
                selected = CapturePixelGeometry.Crop(backdrop, new(selection.X - desktop.X, selection.Y - desktop.Y, selection.Width, selection.Height));
            }
            else if (request.Target.Kind == CaptureTargetKind.Window)
            {
                var before = platform.GetWindowBounds(request.Target.Handle, false);
                selection = platform.GetWindowBounds(request.Target.Handle, request.Target.ClientArea);
                CapturePixelGeometry.ValidateContained(desktop, selection);
                var pixels = await platform.CaptureItemAsync(CaptureTargetKind.Window, request.Target.Handle, request.TimeoutMs, deadline.Token).ConfigureAwait(false);
                if (before != platform.GetWindowBounds(request.Target.Handle, false)
                    || selection != platform.GetWindowBounds(request.Target.Handle, request.Target.ClientArea)
                    || before.Width != pixels.Size.Width || before.Height != pixels.Size.Height)
                    throw new CaptureException("capture_geometry_changed", "窗口位置或尺寸在捕获期间变化，请重新截图。");
                CapturePixelGeometry.ValidateContained(before, selection);
                selected = CapturePixelGeometry.Crop(pixels, new(selection.X - before.X, selection.Y - before.Y, selection.Width, selection.Height));
            }
            // 热插拔、重排和主屏切换都作废本次底图；枚举次序本身不影响布局。
            var finalMonitors = platform.GetMonitors();
            if (monitors.Length != finalMonitors.Count || !monitors.OrderBy(m => m.Handle.ToInt64())
                .SequenceEqual(finalMonitors.OrderBy(m => m.Handle.ToInt64())))
                throw new CaptureException("capture_geometry_changed", "显示器布局在捕获期间变化，请重新截图。");
            deadline.Token.ThrowIfCancellationRequested();
            return new(backdrop, selected, desktop, selection, monitors.Select(m => new CaptureScreen(m.Bounds, m.Primary, m.WorkArea)).ToArray());
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new CaptureException("capture_timeout", "WGC 捕获超时，请检查目标或重试。"); }
    }
}
