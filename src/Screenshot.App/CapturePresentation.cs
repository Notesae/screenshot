using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Media.Imaging;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App;

// 单个显示器的物理像素范围；不将某一显示器的 DPI 套用于整个桌面。
public sealed record CaptureScreen(PixelRect Bounds, bool Primary, PixelRect? WorkArea = null);
// 仅含几何元数据，冻结桌面像素不会进入编辑器、项目或 AI 请求。
public sealed record CaptureOverlay(string CaptureId, PixelRect DesktopBounds, PixelRect Selection, IReadOnlyList<CaptureScreen> Screens,
    string Backend = "gdi", string ColorMode = "sdr", bool SupportsHdr = false);
// 发往编辑器的捕获数据，只含选区像素和定位紧凑画布所需的几何信息。
public sealed record CaptureEnvelope(LoadedImage Image, CaptureOverlay Overlay);

// 首次框选的原生画面保留到编辑器接手；实现只能在宿主内部持有，不跨桥接。
internal interface ICaptureHandoff : IDisposable { bool IsCancelled { get; } void KeepAbove(nint owner); }

// 原生捕获结果同时持有选区图片和只供 WPF 显示的冻结桌面。
public sealed record CapturedFrame(LoadedImage Image, [property: JsonIgnore] BitmapSource FrozenDesktop,
    PixelRect DesktopBounds, PixelRect Selection, IReadOnlyList<CaptureScreen> Screens)
{
    public string CaptureId { get; } = Guid.NewGuid().ToString("N");
    public string Backend { get; init; } = "gdi";
    [JsonIgnore] internal ICaptureHandoff? Handoff { get; init; }
    public CaptureEnvelope ToEnvelope() => new(Image, new(CaptureId, DesktopBounds, Selection, Screens, Backend));
}

// 按捕获身份释放临时原生画面，迟到的布局应答不能关闭后一次框选。
internal sealed class CaptureHandoffState
{
    private string? _captureId;
    private ICaptureHandoff? _visual;
    public bool IsCancelled(string captureId) => _captureId==captureId&&_visual?.IsCancelled==true;
    public bool HasVisual(string captureId)=>_captureId==captureId&&_visual is not null;
    public void KeepAbove(string captureId,nint owner){if(_captureId==captureId&&_visual?.IsCancelled==false)_visual.KeepAbove(owner);}
    public void Take(CapturedFrame frame) { Release(); _captureId=frame.CaptureId; _visual=frame.Handoff; }
    public void Release(string? captureId=null)
    {
        if(captureId is not null&&captureId!=_captureId)return;
        var visual=_visual;_visual=null;_captureId=null;visual?.Dispose();
    }
}

// 工作台、就地覆盖层与隐藏状态；隐藏仍保留 WebView 中的编辑文档。
public enum PresentationMode { Workbench, Overlay, Hidden }

// 不依赖窗口的显示生命周期，保证取消不清文档、退出及时释放冻结桌面引用。
internal sealed class CapturePresentationState
{
    // 选择取消时恢复旧呈现，成功或显式退出时解除对旧冻结图的引用。
    private sealed record SelectionSnapshot(PresentationMode Mode, BitmapSource? Backdrop, CaptureOverlay? Overlay, string? PendingId, string? PreparedId);
    private SelectionSnapshot? _beforeSelection;
    public PresentationMode Mode { get; private set; } = PresentationMode.Workbench;
    public BitmapSource? FrozenBackdrop { get; private set; }
    public CaptureOverlay? Overlay { get; private set; }
    public string? PendingCaptureId { get; private set; }
    private string? _preparedCaptureId; // 已在原生遮挡后展示宿主，尚未取得浏览器绘制确认。
    public bool IsPrepared(string captureId)=>Matches(captureId)&&PendingCaptureId==captureId&&_preparedCaptureId==captureId;
    public bool IsSelecting => _beforeSelection is not null;

    // 选择开始时保留旧呈现；后台捕获或用户取消不修改已有编辑内容。
    public void BeginCapture()
    {
        if (IsSelecting) throw new InvalidOperationException("正在选择截图区域。");
        _beforeSelection = new(Mode, FrozenBackdrop, Overlay, PendingCaptureId, _preparedCaptureId);
    }

    // 取消恢复选择前的显示状态和冻结图；显式退出已清除快照时不回滚退出操作。
    public void CancelCapture()
    {
        if (_beforeSelection is not { } previous) return;
        Mode = previous.Mode; FrozenBackdrop = previous.Backdrop; Overlay = previous.Overlay; PendingCaptureId = previous.PendingId; _preparedCaptureId=previous.PreparedId;
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
        Mode = PresentationMode.Overlay; PendingCaptureId = frame.CaptureId; _preparedCaptureId=null; _beforeSelection = null;
        return true;
    }

    // 第一阶段只登记宿主已展示，超时保护仍保持，不能据此释放原生遮挡。
    public bool TryPrepare(string captureId){if(!Matches(captureId)||PendingCaptureId!=captureId||_preparedCaptureId is not null)return false;_preparedCaptureId=captureId;return true;}
    public bool TryAcceptPainted(string captureId)=>IsPrepared(captureId)&&TryAcceptReady(captureId);

    // 仅接受当前截图的一次布局确认，防止迟到确认显示其他截图或已关闭的覆盖层。
    public bool TryAcceptReady(string captureId)
    {
        if (IsSelecting || Mode != PresentationMode.Overlay || PendingCaptureId != captureId) return false;
        PendingCaptureId = null; _preparedCaptureId=null; return true;
    }

    // 只从本次原生冻结图裁剪；过期身份、未就绪状态及越界区域均不能读取像素。
    public async Task<CaptureEnvelope> AdjustAsync(string captureId, PixelRect selection, CancellationToken token=default)
    {
        if (!Matches(captureId) || PendingCaptureId is not null || FrozenBackdrop is not { } frozen || Overlay is not { } overlay)
            throw new InvalidOperationException("截图已失效，请重新截图。");
        var bounds = overlay.DesktopBounds;
        if (selection.Width < 2 || selection.Height < 2 || selection.Width > 16000 || selection.Height > 16000
            || (long)selection.Width * selection.Height > 40_000_000 || selection.X < bounds.X || selection.Y < bounds.Y
            || (long)selection.X + selection.Width > (long)bounds.X + bounds.Width || (long)selection.Y + selection.Height > (long)bounds.Y + bounds.Height)
            throw new InvalidOperationException("选区超出冻结桌面或图片尺寸限制。");
        // 冻结图可安全跨线程读取；编码和 Base64 转换不阻塞原生覆盖层重绘。
        var image = await Task.Run(()=>NativeImages.FromBitmap(new CroppedBitmap(frozen,new Int32Rect(selection.X-bounds.X,selection.Y-bounds.Y,selection.Width,selection.Height)),"区域截图.png"),token);
        token.ThrowIfCancellationRequested();
        if(!Matches(captureId)||!ReferenceEquals(FrozenBackdrop,frozen)||PendingCaptureId is not null)throw new InvalidOperationException("截图已失效，请重新截图。");
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
    private void ReleaseBackdrop() { FrozenBackdrop = null; Overlay = null; PendingCaptureId = null; _preparedCaptureId=null; _beforeSelection = null; }
}

// 根据实际 Win32 客户区补偿边框偏移；输入和输出始终为物理像素。
internal static class OverlayWindowGeometry
{
    public static PixelRect FitClient(PixelRect target, PixelRect outer, PixelRect client) => new(
        outer.X + target.X - client.X, outer.Y + target.Y - client.Y,
        outer.Width + target.Width - client.Width, outer.Height + target.Height - client.Height);
}
