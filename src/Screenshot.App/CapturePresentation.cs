using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Media.Imaging;

namespace Screenshot.App;

// 单个显示器的物理像素范围；不将某一显示器的 DPI 套用于整个桌面。
public sealed record CaptureScreen(PixelRect Bounds, bool Primary, PixelRect? WorkArea = null);
// 仅含几何元数据，冻结桌面像素不会进入编辑器、项目或 AI 请求。
public sealed record CaptureOverlay(string CaptureId, PixelRect DesktopBounds, PixelRect Selection, IReadOnlyList<CaptureScreen> Screens,
    string Backend = "gdi", string ColorMode = "sdr", bool SupportsHdr = false);
// 发往编辑器的捕获数据，只含选区像素和定位紧凑画布所需的几何信息。
public sealed record CaptureEnvelope(LoadedImage Image, CaptureOverlay Overlay);

// 原生捕获结果同时持有选区图片和只供 WPF 显示的冻结桌面。
public sealed record CapturedFrame(LoadedImage Image, [property: JsonIgnore] BitmapSource FrozenDesktop,
    PixelRect DesktopBounds, PixelRect Selection, IReadOnlyList<CaptureScreen> Screens)
{
    public string CaptureId { get; } = Guid.NewGuid().ToString("N");
    public string Backend { get; init; } = "gdi";
    public CaptureEnvelope ToEnvelope() => new(Image, new(CaptureId, DesktopBounds, Selection, Screens, Backend));
}

// 工作台、就地覆盖层与隐藏状态；隐藏仍保留 WebView 中的编辑文档。
public enum PresentationMode { Workbench, Overlay, Hidden }

// 不依赖窗口的显示生命周期，保证取消不清文档、退出及时释放冻结桌面引用。
internal sealed class CapturePresentationState
{
    // 选择取消时恢复旧呈现，成功或显式退出时解除对旧冻结图的引用。
    private sealed record SelectionSnapshot(PresentationMode Mode, BitmapSource? Backdrop, CaptureOverlay? Overlay, string? PendingId);
    private SelectionSnapshot? _beforeSelection;
    public PresentationMode Mode { get; private set; } = PresentationMode.Workbench;
    public BitmapSource? FrozenBackdrop { get; private set; }
    public CaptureOverlay? Overlay { get; private set; }
    public string? PendingCaptureId { get; private set; }
    public bool IsSelecting => _beforeSelection is not null;

    // 选择开始时保留旧呈现；后台捕获或用户取消不修改已有编辑内容。
    public void BeginCapture()
    {
        if (IsSelecting) throw new InvalidOperationException("正在选择截图区域。");
        _beforeSelection = new(Mode, FrozenBackdrop, Overlay, PendingCaptureId);
    }

    // 取消恢复选择前的显示状态和冻结图；显式退出已清除快照时不回滚退出操作。
    public void CancelCapture()
    {
        if (_beforeSelection is not { } previous) return;
        Mode = previous.Mode; FrozenBackdrop = previous.Backdrop; Overlay = previous.Overlay; PendingCaptureId = previous.PendingId;
        _beforeSelection = null;
    }

    // 校验物理坐标与像素尺寸后替换背景，等待前端对本次捕获的布局确认。
    public bool CompleteCapture(CapturedFrame frame)
    {
        if (!IsSelecting) return false;
        var bounds = frame.DesktopBounds; var selected = frame.Selection;
        if (bounds.Width != frame.FrozenDesktop.PixelWidth || bounds.Height != frame.FrozenDesktop.PixelHeight
            || selected.Width != frame.Image.Width || selected.Height != frame.Image.Height || selected.Width <= 0 || selected.Height <= 0
            || selected.X < bounds.X || selected.Y < bounds.Y || (long)selected.X + selected.Width > (long)bounds.X + bounds.Width
            || (long)selected.Y + selected.Height > (long)bounds.Y + bounds.Height)
            throw new InvalidOperationException("截图像素与桌面坐标不一致。");
        if (!frame.FrozenDesktop.IsFrozen) frame.FrozenDesktop.Freeze();
        FrozenBackdrop = frame.FrozenDesktop; Overlay = frame.ToEnvelope().Overlay;
        Mode = PresentationMode.Overlay; PendingCaptureId = frame.CaptureId; _beforeSelection = null;
        return true;
    }

    // 仅接受当前截图的一次布局确认，防止迟到确认显示其他截图或已关闭的覆盖层。
    public bool TryAcceptReady(string captureId)
    {
        if (IsSelecting || Mode != PresentationMode.Overlay || PendingCaptureId != captureId) return false;
        PendingCaptureId = null; return true;
    }

    // 只从本次原生冻结图裁剪；过期身份、未就绪状态及越界区域均不能读取像素。
    public CaptureEnvelope Adjust(string captureId, PixelRect selection)
    {
        if (!Matches(captureId) || PendingCaptureId is not null || FrozenBackdrop is not { } frozen || Overlay is not { } overlay)
            throw new InvalidOperationException("截图已失效，请重新截图。");
        var bounds = overlay.DesktopBounds;
        if (selection.Width < 2 || selection.Height < 2 || selection.Width > 16000 || selection.Height > 16000
            || (long)selection.Width * selection.Height > 40_000_000 || selection.X < bounds.X || selection.Y < bounds.Y
            || (long)selection.X + selection.Width > (long)bounds.X + bounds.Width || (long)selection.Y + selection.Height > (long)bounds.Y + bounds.Height)
            throw new InvalidOperationException("选区超出冻结桌面或图片尺寸限制。");
        var crop = new CroppedBitmap(frozen, new Int32Rect(selection.X - bounds.X, selection.Y - bounds.Y, selection.Width, selection.Height));
        var image = NativeImages.FromBitmap(crop, "区域截图.png");
        // 前端接受的图片最多 24 MiB，超限时保持宿主选区不变。
        if (image.DataUrl.Length > 24 * 1024 * 1024 * 4L / 3 + 64) throw new InvalidOperationException("选区图片过大，请缩小选区。");
        Overlay = overlay with { Selection = selection };
        return new(image, Overlay);
    }

    // 只终止仍等待当前截图布局的覆盖层；旧计时器不能关闭更新的截图。
    public bool TryExpireReady(string captureId)
    {
        if (IsSelecting || Mode != PresentationMode.Overlay || PendingCaptureId != captureId) return false;
        ShowWorkbench(); return true;
    }

    // 覆盖层必须匹配当前截图；工作台或隐藏状态才允许无 ID，避免旧导入清理新背景。
    public bool TryShowWorkbench(string? captureId)
    {
        if (IsSelecting || (Mode == PresentationMode.Overlay ? string.IsNullOrEmpty(captureId) || Overlay?.CaptureId != captureId : captureId is not null)) return false;
        ShowWorkbench(); return true;
    }

    // 旧 Esc 或退出消息不能隐藏已被新截图替换的覆盖层。
    public bool TryDismiss(string? captureId)
    {
        if (!Matches(captureId)) return false;
        Dismiss(); return true;
    }

    public bool Matches(string? captureId) => !IsSelecting && (Mode == PresentationMode.Overlay
        ? !string.IsNullOrEmpty(captureId) && Overlay?.CaptureId == captureId : captureId is null);

    public void ShowWorkbench() { Mode = PresentationMode.Workbench; ReleaseBackdrop(); }
    public void Dismiss() { Mode = PresentationMode.Hidden; ReleaseBackdrop(); }
    private void ReleaseBackdrop() { FrozenBackdrop = null; Overlay = null; PendingCaptureId = null; _beforeSelection = null; }
}

// 根据实际 Win32 客户区补偿边框偏移；输入和输出始终为物理像素。
internal static class OverlayWindowGeometry
{
    public static PixelRect FitClient(PixelRect target, PixelRect outer, PixelRect client) => new(
        outer.X + target.X - client.X, outer.Y + target.Y - client.Y,
        outer.Width + target.Width - client.Width, outer.Height + target.Height - client.Height);
}
