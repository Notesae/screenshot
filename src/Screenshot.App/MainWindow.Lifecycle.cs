using System;
using System.ComponentModel;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace Screenshot.App;

public partial class MainWindow
{
    private readonly TaskCompletionSource _editorMounted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly EditorCheckpoint _checkpoint = new();
    private bool _closingAllowed, _closingPending;
    private CompletionToastWindow? _completionToast;
    private long _completionSequence;
    private bool _preserving;
    private bool _startingInTray;

    // 透明且不激活地加载 WebView；条款门禁之后才创建托盘和热键，不显示启动空白页。
    internal async Task StartInTrayAsync()
    {
        _startingInTray = true;
        Opacity = 0; ShowActivated = false; ShowInTaskbar = false;
        Show();
        try
        {
            await InitializeEditorAsync();
            await _editorMounted.Task.WaitAsync(TimeSpan.FromSeconds(20));
            DismissPresentation();
            _startingInTray = false;
            Opacity = 1; ShowActivated = true;
            if (_trayIcon is null || _hotkeys?.State is { Binding.Enabled: true, Registered: false })
                ShowEditorAction("notice", "托盘或快捷键不可用，请在这里截图或调整设置。");
        }
        catch (Exception error)
        {
            _startingInTray = false;
            Opacity = 1; ShowActivated = true; ShowWorkbench();
            Status.Text = "编辑器启动失败，请重试或退出：" + error.Message;
        }
    }

    private async void RetryEditor(object sender, RoutedEventArgs args)
    {
        // 已挂载的会话不能把重载当成清空文档的捷径。
        try
        {
            await PreserveEditorAsync("close");
            InvalidateCompletion();
            if (Editor.CoreWebView2 is { } core) { _ready = false; core.Reload(); }
            else await InitializeEditorAsync();
        }
        catch (Exception error) { Status.Text = "重试失败：" + error.Message; }
    }
    private void StartCapture(object sender, RoutedEventArgs args) => _ = CaptureFromHotkeyAsync();

    private void ShowEditorAction(string action, string? text = null)
    {
        if (_presentation.IsSelecting) return;
        InvalidateCompletion();
        ShowWorkbenchFromTray();
        if (_ready) Post(new { @event = "editor.action", payload = new { action, text } });
        else Status.Text = text ?? "编辑器尚未就绪，请重试加载。";
    }

    private void ShowEditorNotice(string text)
    {
        // 错误只更新提示；已有原位层不能因保存失败而释放冻结背景。
        if (_ready && IsVisible) Post(new { @event = "editor.action", payload = new { action = "notice", text } });
        else ShowEditorAction("notice", text);
    }

    // 更新仅在快照成功且外部更新器已接手之后调用，避免 Shutdown 内再启动异步保存。
    internal void AllowSavedShutdown() { _closingAllowed = true; InvalidateCompletion(); }

    // 同一个检查用于覆盖、关闭和输出收起；失败时调用方保持窗口、文档及旧冻结层。
    private async Task PreserveEditorAsync(string reason, string? documentId = null, long? revision = null)
    {
        if (!_editorMounted.Task.IsCompletedSuccessfully) return;
        if (!_ready || Editor.CoreWebView2 is not { } core) throw new IOException("编辑器尚未就绪，无法确认保存，已保留当前编辑。");
        if (_preserving) throw new IOException("正在确认保存，请稍后再试。");
        _preserving = true;
        try
        {
            var script = "window.screenshotPrepareLeave?.(" + JsonSerializer.Serialize(reason) + ") ?? null";
            using var result = JsonDocument.Parse(await core.ExecuteScriptAsync(script));
            var checkpoint = _checkpoint.Prepare(result.RootElement, documentId, revision);
            if (checkpoint is { } item)
            {
                var saved = await RunRecoveryAsync(store => store.SaveAsync(item.Id, item.Revision, item.Document, _lifetime.Token));
                if (!saved.Saved || saved.Stale) throw new IOException("恢复快照未保存成功，已保留当前编辑。请重试或手动保存项目。");
            }
        }
        finally { try { await core.ExecuteScriptAsync("window.screenshotFinishLeave?.()"); } finally { _preserving = false; } }
    }

    private async void ProtectClosing(object? sender, CancelEventArgs args)
    {
        if (_closingAllowed) return;
        args.Cancel = true;
        if (_closingPending) return;
        _closingPending = true;
        try { await PreserveEditorAsync("close"); _closingAllowed = true; Close(); }
        catch (Exception error)
        {
            ShowEditorNotice(error.Message);
            if (MessageBox.Show(this, error.Message + "\n\n是否明确放弃未保存的更改并退出？选择“否”可继续编辑或保存项目。", "尚未安全保存", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) == MessageBoxResult.Yes)
            { _closingAllowed = true; Close(); }
        }
        finally { _closingPending = false; }
    }

    private void InvalidateCompletion()
    {
        _completionSequence++; _completionToast?.Close(); _completionToast = null;
    }

    private async Task<object> CompleteEditingAsync(JsonElement payload)
    {
        var text = RequiredString(payload, "text");
        if (text is not ("图片已复制到剪贴板" or "PNG 已保存")) throw new IOException("输出完成状态无效。");
        var captureId = OptionalString(payload, "captureId");
        if (!_presentation.Matches(captureId)) return new { accepted = false };
        var requestedSequence = _completionSequence;
        await PreserveEditorAsync("complete", RequiredString(payload, "documentId"), payload.GetProperty("revision").GetInt64());
        if (requestedSequence != _completionSequence || !_presentation.Matches(captureId)) return new { accepted = false };
        // 虚拟桌面覆盖窗口可能横跨所有屏幕；提示跟随选区，而不是窗口覆盖面积最大的主屏。
        var anchor = CaptureAnchor();
        var work = System.Windows.Forms.Screen.FromRectangle(new System.Drawing.Rectangle(anchor.X, anchor.Y, anchor.Width, anchor.Height)).WorkingArea;
        var area = new PixelRect(work.X, work.Y, work.Width, work.Height);
        if (!_presentation.TryDismiss(captureId)) return new { accepted = false };
        DismissPresentation(); InvalidateCompletion();
        var sequence = _completionSequence;
        _completionToast = new CompletionToastWindow(text, () => { if (sequence == _completionSequence) ShowEditorAction("continue"); }, area);
        _completionToast.Show();
        return new { accepted = true, presentation = "hidden" };
    }
}
