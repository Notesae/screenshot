using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Interop;
using Forms = System.Windows.Forms;

namespace Screenshot.App;

public partial class MainWindow
{
    // 钉图只驻留当前进程；关闭窗口即移除引用，不写原图、项目或持久化桌面配置。
    private readonly HashSet<PinnedImageWindow> _pinnedImages = new();

    /// <summary>核对成品所属文档后创建独立浮窗；创建失败保留编辑器，成功后才释放冻结桌面。</summary>
    private async Task<object> PinImageAsync(JsonElement payload)
    {
        var captureId = OptionalString(payload, "captureId");
        if (!IsVisible || _presentation.Mode == PresentationMode.Hidden || _presentation.PendingCaptureId is not null || !_presentation.Matches(captureId)) return new { accepted = false };
        if (_pinnedImages.Count >= 8) throw new InvalidOperationException("最多同时保留 8 张钉图，请先关闭不需要的钉图。");
        var sequence = _completionSequence;
        var dataUrl = RequiredString(payload, "dataUrl");
        var bitmap = await Task.Run(() => NativeImages.DecodePng(dataUrl), _lifetime.Token);
        if (bitmap.PixelWidth > 16000 || bitmap.PixelHeight > 16000 || (long)bitmap.PixelWidth * bitmap.PixelHeight > 40_000_000)
            throw new InvalidOperationException("钉图尺寸不能超过 16000 像素或 4000 万总像素。");
        if (_pinnedImages.Sum(window => window.PixelCount) + (long)bitmap.PixelWidth * bitmap.PixelHeight > 80_000_000)
            throw new InvalidOperationException("钉图占用较多内存，请先关闭部分钉图再试。");
        await CheckEditorAsync("pin", RequiredString(payload, "documentId"), payload.GetProperty("revision").GetInt64());
        if (_lifetime.IsCancellationRequested || sequence != _completionSequence || !IsVisible || _presentation.PendingCaptureId is not null || !_presentation.Matches(captureId)) return new { accepted = false };
        // 原位截图优先使用选区所在屏幕；普通导入使用编辑窗口所在屏幕。
        var screen = _presentation.Overlay is { } overlay
            ? Forms.Screen.FromPoint(new System.Drawing.Point(overlay.Selection.X + overlay.Selection.Width / 2, overlay.Selection.Y + overlay.Selection.Height / 2))
            : Forms.Screen.FromHandle(new WindowInteropHelper(this).Handle);
        var window = new PinnedImageWindow(bitmap, screen.WorkingArea);
        window.Closed += (_, _) => _pinnedImages.Remove(window);
        try
        {
            window.Show(); _pinnedImages.Add(window);
            DismissPresentation(); InvalidateCompletion();
            window.Activate();
            return new { accepted = true, pinned = true, presentation = "hidden" };
        }
        catch { window.Close(); throw; }
    }
}
