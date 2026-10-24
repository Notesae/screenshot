using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace Screenshot.App;

public partial class MainWindow
{
    // 图像处理在后台，剪贴板提交与确认显式回到主 STA；失败不发送 copied=true，也不收起文档。
    private async Task<object> CopyImageAsync(JsonElement payload)
    {
        var trace = _presentation.Overlay?.CaptureId is { } id && _captureDiagnostics?.CaptureId == id ? _captureDiagnostics : null;
        var stage = "prepare"; ClipboardImageStatus? status = null;
        try
        {
            var dataUrl = RequiredString(payload, "dataUrl");
            var image = await Task.Run(() => NativeImages.PrepareClipboardImage(dataUrl), _lifetime.Token);
            _lifetime.Token.ThrowIfCancellationRequested();
            stage = "write";
            await Dispatcher.InvokeAsync(image.Write, DispatcherPriority.Normal, _lifetime.Token);
            stage = "confirm";
            for (var attempt = 0; attempt < 4; attempt++)
            {
                var state = await Dispatcher.InvokeAsync(image.Confirm, DispatcherPriority.Normal, _lifetime.Token);
                status = state;
                if (state == ClipboardImageStatus.Ready)
                {
                    trace?.Mark("clipboard_image_committed", details: new { image.Width, image.Height }); trace?.Flush();
                    return new { copied = true };
                }
                if (state != ClipboardImageStatus.Busy) break;
                // 只重试短暂被占用的确认，不再次写入，不覆盖期间由其他应用复制的新内容。
                if (attempt < 3) await Task.Delay(30, _lifetime.Token);
            }
            throw new IOException("图片未能可靠写入剪贴板，已保留当前编辑，请重新完成。");
        }
        catch (Exception error) { trace?.Fail("clipboard_image_failed", new { errorType = error.GetType().Name, stage, clipboardState = status?.ToString() }); throw; }
    }
}
