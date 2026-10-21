using System;
using System.ComponentModel;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Screenshot.App;

public partial class MainWindow
{
    private readonly TaskCompletionSource _editorMounted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly EditorCheckpoint _checkpoint = new();
    private bool _closingAllowed, _closingPending;
    private long _completionSequence;
    private bool _preserving;
    private bool _startingInTray;
    private Window? _startupNotice; // 仅错误或用户在预热期间操作时显示的小型提示。
    private Window? _transientNotice; // 隐藏时的错误只用不激活的短提示，不能切换到编辑器。
    private ProviderSettingsWindow? _settingsWindow; // 托盘与编辑器共用单个设置窗口，不恢复历史图片。

    // 屏外无边框宿主只负责 WebView 预热，用户桌面不展示主窗口或加载黑底。
    internal async Task StartInTrayAsync()
    {
        _startingInTray = true;
        _startupNotice?.Close();
        Opacity=0;ShowActivated=false;ShowInTaskbar=false;
        WindowStartupLocation=WindowStartupLocation.Manual;WindowStyle=WindowStyle.None;ResizeMode=ResizeMode.NoResize;
        MinWidth=0;MinHeight=0;Width=1100;Height=760;Left=-32000;Top=-32000;
        try
        {
            Show();
            await InitializeEditorAsync();
            await _editorMounted.Task.WaitAsync(TimeSpan.FromSeconds(20));
            DismissPresentation();
            _startingInTray = false;
            Opacity = 1; ShowActivated = true;
            if (_trayIcon is null || _hotkeys?.State is { Binding.Enabled: true, Registered: false })
                ShowStartupNotice("托盘或快捷键不可用，可以打开设置调整。","打开设置",()=>ShowEditorAction("settings"));
        }
        catch (Exception error)
        {
            _startingInTray = false;
            if(_lifetime.IsCancellationRequested)return;
            Hide();Opacity=1;ShowActivated=true;
            ShowStartupNotice("编辑器启动失败："+error.Message,"重试启动",()=>{_=StartInTrayAsync();});
        }
    }

    // 启动失败只用独立软泥提示提供恢复入口，不展开空编辑器或系统标题栏。
    private void ShowStartupNotice(string text,string actionText="关闭提示",Action? action=null)
    {
        _startupNotice?.Close();
        var notice=new Window{Width=440,SizeToContent=SizeToContent.Height,WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,ShowInTaskbar=false,Topmost=true,AllowsTransparency=true,Background=Brushes.Transparent,WindowStartupLocation=WindowStartupLocation.CenterScreen};
        var panel=new StackPanel{Margin=new Thickness(18)};
        panel.Children.Add(new TextBlock{Text="Screenshot",FontSize=15,FontWeight=FontWeights.SemiBold,Foreground=SoftClayTheme.Brush("ink")});
        panel.Children.Add(new TextBlock{Text=text,TextWrapping=TextWrapping.Wrap,Foreground=SoftClayTheme.Brush("muted"),Margin=new Thickness(0,10,0,16)});
        var actions=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};
        var retry=new Button{Content=actionText,Style=SoftClayTheme.ButtonStyle(),Background=SoftClayTheme.Surface(true)};
        retry.Click+=(_,_)=>{notice.Close();action?.Invoke();};actions.Children.Add(retry);
        var exit=new Button{Content="退出应用",Style=SoftClayTheme.ButtonStyle(),Margin=new Thickness(10,0,0,0)};
        exit.Click+=(_,_)=>{notice.Close();Close();};actions.Children.Add(exit);panel.Children.Add(actions);
        notice.Content=new Border{Background=SoftClayTheme.Surface(),CornerRadius=new CornerRadius(SoftClayTheme.Number("radius","floating")),Margin=new Thickness(14),Effect=SoftClayTheme.Shadow(),Child=panel};
        notice.Closed+=(_,_)=>{if(ReferenceEquals(_startupNotice,notice))_startupNotice=null;};
        _startupNotice=notice;notice.Show();
    }

    private async void RetryEditor(object sender, RoutedEventArgs args)
    {
        // 已挂载的会话不能把重载当成清空文档的捷径。
        try
        {
            await CheckEditorAsync("close");
            InvalidateCompletion();
            if (Editor.CoreWebView2 is { } core) { _ready = false; core.Reload(); }
            else await InitializeEditorAsync();
        }
        catch (Exception error) { Status.Text = "重试失败：" + error.Message; }
    }
    private void StartCapture(object sender, RoutedEventArgs args) => _ = CaptureFromHotkeyAsync();

    private void ShowEditorAction(string action, string? text = null)
    {
        if (action == "settings") { ShowSettingsFromTray(); return; }
        if (_presentation.IsSelecting) return;
        if(!_ready||!_editorMounted.Task.IsCompletedSuccessfully){ShowStartupNotice("截图工具正在准备，请稍后再试。");return;}
        InvalidateCompletion();
        ShowWorkbenchFromTray();
        if (_ready) Post(new { @event = "editor.action", payload = new { action, text } });
        else Status.Text = text ?? "编辑器尚未就绪，请重试加载。";
    }

    // 设置直接在原生层打开；隐藏宿主不作为 Owner，避免模态窗口顺带唤起旧编辑画面。
    private void OpenSettingsWindow(string section = "capture")
    {
        if (_settingsWindow is not null) { _settingsWindow.Activate(); return; }
        var window = new ProviderSettingsWindow(_ai, SaveBeforeUpdateAsync, ExecuteAsync,
            owner => new TermsWindow(_terms, reviewOnly: true) { Owner = owner }.ShowDialog(), section);
        if (IsVisible) window.Owner = this;
        else window.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        _settingsWindow = window;
        try { window.ShowDialog(); }
        finally { _settingsWindow = null; Post(new { @event = "editor.action", payload = new { action = "settings-updated" } }); }
    }

    // 托盘入口仍受本地操作互斥保护，和网页设置共享行为但不经过 ShowWorkbenchFromTray。
    private void ShowSettingsFromTray()
    {
        if (_settingsWindow is not null) { _settingsWindow.Activate(); return; }
        if (_presentation.IsSelecting) return;
        if (!_requests.TryEnter("settings.configure", out var lease)) { ShowEditorNotice("正在处理另一项操作，请稍后打开设置。"); return; }
        try { _terms.RequireAccepted(); OpenSettingsWindow(); }
        catch (Exception error) { ShowEditorNotice("无法打开设置：" + error.Message); }
        finally { lease?.Dispose(); }
    }

    private void ShowEditorNotice(string text)
    {
        // 可见时就地提示；驻留托盘时保持原呈现，不为展示错误唤起工作台。
        if (_ready && IsVisible) Post(new { @event = "editor.action", payload = new { action = "notice", text } });
        else
        {
            _transientNotice?.Close();
            var area=SystemParameters.WorkArea;
            var notice=new Window{Width=Math.Min(440,area.Width-32),SizeToContent=SizeToContent.Height,WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,ShowActivated=false,ShowInTaskbar=false,Topmost=true,AllowsTransparency=true,Background=Brushes.Transparent,IsHitTestVisible=false};
            notice.Content=new Border{Margin=new Thickness(12),Padding=new Thickness(16,12,16,12),Background=SoftClayTheme.Surface(),CornerRadius=new CornerRadius(12),Effect=SoftClayTheme.Shadow(),Child=new TextBlock{Text=text,TextWrapping=TextWrapping.Wrap,Foreground=SoftClayTheme.Brush("ink"),FontSize=13}};
            var timer=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromSeconds(4)};
            timer.Tick+=(_,_)=>notice.Close();
            notice.Loaded+=(_,_)=>{notice.Left=area.Right-notice.ActualWidth-16;notice.Top=area.Bottom-notice.ActualHeight-16;timer.Start();};
            notice.Closed+=(_,_)=>{timer.Stop();if(ReferenceEquals(_transientNotice,notice))_transientNotice=null;};
            _transientNotice=notice;notice.Show();
        }
    }

    // 外部更新器已接手后允许退出；更新与退出均不自动保存编辑内容。
    internal void AllowSavedShutdown() { _closingAllowed = true; InvalidateCompletion(); }

    // 只验证覆盖、关闭和完成的忙状态与文档身份，不写恢复库；失败保留当前编辑。
    private async Task CheckEditorAsync(string reason, string? documentId = null, long? revision = null)
    {
        if (!_editorMounted.Task.IsCompletedSuccessfully) return;
        if (!_ready || Editor.CoreWebView2 is not { } core) throw new IOException("编辑器尚未就绪，已保留当前编辑。");
        if (_preserving) throw new IOException("正在确认编辑状态，请稍后再试。");
        _preserving = true;
        try
        {
            var script = "window.screenshotPrepareLeave?.(" + JsonSerializer.Serialize(reason) + ") ?? null";
            using var result = JsonDocument.Parse(await core.ExecuteScriptAsync(script));
            _checkpoint.Validate(result.RootElement, documentId, revision);
        }
        finally { try { await core.ExecuteScriptAsync("window.screenshotFinishLeave?.()"); } finally { _preserving = false; } }
    }

    private async void ProtectClosing(object? sender, CancelEventArgs args)
    {
        if (_closingAllowed) return;
        args.Cancel = true;
        if (_closingPending) return;
        _closingPending = true;
        try { await CheckEditorAsync("close"); _closingAllowed = true; Close(); }
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
        _completionSequence++;
    }

    // 完成只核对当前输出身份并收起，不写入快照或创建继续编辑提示。
    private async Task<object> CompleteEditingAsync(JsonElement payload)
    {
        var text = RequiredString(payload, "text");
        if (text != "图片已复制到剪贴板") throw new IOException("输出完成状态无效。");
        var captureId = OptionalString(payload, "captureId");
        if (!_presentation.Matches(captureId)) return new { accepted = false };
        var requestedSequence = _completionSequence;
        await CheckEditorAsync("complete", RequiredString(payload, "documentId"), payload.GetProperty("revision").GetInt64());
        if (requestedSequence != _completionSequence || !_presentation.Matches(captureId)) return new { accepted = false };
        if (!_presentation.TryDismiss(captureId)) return new { accepted = false };
        DismissPresentation(); InvalidateCompletion();
        return new { accepted = true, presentation = "hidden" };
    }
}
