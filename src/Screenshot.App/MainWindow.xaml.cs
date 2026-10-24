using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Screenshot.AI;
using Screenshot.Ocr;
using Screenshot.Storage;

namespace Screenshot.App;
// 承载本地编辑器，将受信任的桥接请求分发到 Windows 原生能力。
public partial class MainWindow : Window
{
    private System.Windows.Controls.ContextMenu? _trayMenu; // 独立托盘浮卡，不打开编辑宿主。
    private readonly AiService _ai = new();
    private readonly IReadOnlyDictionary<string, ICaptureBackend> _captureBackends = new Dictionary<string, ICaptureBackend>
    {
        ["wgc"] = new WgcCaptureBackend(), ["gdi"] = new GdiCaptureBackend()
    };
    private readonly CancellationTokenSource _lifetime = new();
    // 仅用于 PostWebMessageAsJson，不拼进 HTML/脚本；保留 Base64 的 +，避免整图转义膨胀。
    private readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private readonly RequestGate _requests = new();
    private readonly CapturePresentationState _presentation = new();
    private readonly CaptureHandoffState _captureHandoff = new(); // 布局完成前保持原生框选画面。
    private string? _composedCaptureId; // 已收到真实合成帧的捕获，DPI 重试不重复触发同一显示回调。
    private CaptureDiagnostics? _captureDiagnostics; // 当前捕获的本机阶段耗时，便于区分快捷键入口和交接等待。
    private WorkbenchPlacement? _workbenchPlacement;
    private bool _boundsUpdateQueued; // 合并 DPI 更新后的边界校正，避免递归窗口消息。
    private bool _ready;
    private HotkeyManager? _hotkeys;
    private string _hotkeyLoadMessage="";
    private readonly HotkeySettingsStore _hotkeyStore=new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Screenshot","capture-hotkey.json"));
    private HwndSource? _source;
    private System.Windows.Forms.NotifyIcon? _trayIcon; // 隐藏后仍可恢复同一 WebView 中的内存文档。
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    // HWND 的最新 DPI 用于拒绝 WebView 尚未完成缩放的旧布局应答。
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    // 原生遮挡撤掉前提交本进程已排队的 DirectX 更新，不把网页回执当作桌面合成完成。
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref NativePoint point);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
    // 只在工作台中记录窗口布局，覆盖层尺寸不会覆盖用户原来的工作台位置。
    private sealed record WorkbenchPlacement(Rect Bounds, WindowState State, WindowStyle Style, ResizeMode ResizeMode, bool Topmost, bool ShowInTaskbar, double MinWidth, double MinHeight);
    // 绑定窗口生命周期，注册全局快捷键，并在关闭时释放原生资源。
    private readonly TermsStartup _terms;
    internal static MainWindow Create(TermsStartup terms) { terms.RequireAccepted(); return new MainWindow(terms); }
    private MainWindow(TermsStartup terms)
    {
        _terms = terms; terms.RequireAccepted();
        InitializeComponent();
        InitializeBackdropMotion();
        Editor.DefaultBackgroundColor = System.Drawing.Color.Transparent;
        Closing += ProtectClosing;
        SourceInitialized += (_, _) =>
        {
            _terms.RequireAccepted();
            var handle = new WindowInteropHelper(this).Handle;
            _source = HwndSource.FromHwnd(handle); _source.AddHook(WindowMessage);
            var loaded=_hotkeyStore.Load();_hotkeyLoadMessage=loaded.Message;
            _hotkeys=new(new WindowsHotkeyRegistration(handle));_hotkeys.Apply(loaded.Binding,_=>{});
            try { InitializeTray(); } catch (Exception error) { Status.Text = "托盘不可用：" + error.Message; }
        };
        Closed += (_, _) =>
        {
            _lifetime.Cancel();
            _captureHandoff.Release(); _startupNotice?.Close();
            InvalidateCompletion();
            FrozenBackdrop.Source = null; _presentation.Dismiss();
            if (_trayIcon is { } tray)
            {
                if(_trayMenu is {} menu){menu.IsOpen=false;_trayMenu=null;}
                tray.Visible = false; tray.ContextMenuStrip?.Dispose(); tray.Icon?.Dispose(); tray.Dispose(); _trayIcon = null;
            }
            _hotkeys?.Dispose();
            _source?.RemoveHook(WindowMessage); Editor.Dispose(); _ai.Dispose(); DisposeLocalFeatures(); _lifetime.Dispose();
        };
    }
    // 托盘仅提供恢复、复用现有门控截图和退出，不创建第二个编辑器实例。
    private void ShowTerms(object sender, RoutedEventArgs e) => new TermsWindow(_terms, reviewOnly: true) { Owner = this }.ShowDialog();
    // 右键打开独立 WPF 菜单；捕获、文件和会话命令分组，退出与编辑入口分开。
    private void InitializeTray()
    {
        var menu=SoftClayTrayMenu.Create();_trayMenu=menu;
        var region=SoftClayTrayMenu.Command("区域截图","M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M21 16v3a2 2 0 0 1-2 2h-3 M8 21H5a2 2 0 0 1-2-2v-3",()=>{_=CaptureFromHotkeyAsync();});
        menu.Items.Add(region);
        menu.Opened+=(_,_)=>region.InputGestureText=_hotkeys?.State is {Registered:true} state?state.Binding.Label:"";
        menu.Items.Add(SoftClayTrayMenu.Command("当前屏幕截图","M3 4h18v13H3z M8 21h8 M12 17v4",()=>{_=CaptureCurrentFromTrayAsync();}));
        menu.Items.Add(SoftClayTrayMenu.Command("整个桌面截图","M2 5h14v12H2z M16 8h6v12H9v-3 M6 21h6 M9 17v4",()=>{_=CaptureFromTrayAsync(CaptureRequest.Default(false) with{Backend=_captureBackend});}));
        menu.Items.Add(SoftClayTrayMenu.Divider(menu));
        menu.Items.Add(SoftClayTrayMenu.Command("打开图片…","M3 3h18v18H3z M3 16l6-6 4 4 3-3 5 5 M7 7h.01",()=>ShowEditorAction("open-image")));
        menu.Items.Add(SoftClayTrayMenu.Command("打开项目…","M3 7h7l2 2h9v11H3z M3 7V4h7l2 3",()=>ShowEditorAction("open-project")));
        menu.Items.Add(SoftClayTrayMenu.Command("粘贴图片","M9 4H5v17h14V4h-4 M9 2h6v4H9z M8 12h8 M8 16h5",()=>ShowEditorAction("paste")));
        menu.Items.Add(SoftClayTrayMenu.Divider(menu));
        menu.Items.Add(SoftClayTrayMenu.Command("历史记录","M3 3v6h6 M3 9a9 9 0 1 1 1 9 M12 7v5l3 2",()=>ShowEditorAction("recovery")));
        menu.Items.Add(SoftClayTrayMenu.Command("设置","M4 7h16 M4 17h16 M8 4v6 M16 14v6",()=>ShowEditorAction("settings")));
        menu.Items.Add(SoftClayTrayMenu.Divider(menu));
        menu.Items.Add(SoftClayTrayMenu.Command("退出应用","M10 3H4v18h6 M14 8l5 4-5 4 M8 12h11",Close));
        _trayIcon=new System.Windows.Forms.NotifyIcon{Icon=System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!),Text="Screenshot · 截图",Visible=true};
        _trayIcon.MouseUp+=(_,args)=>{if(args.Button==System.Windows.Forms.MouseButtons.Right)Dispatcher.BeginInvoke(new Action(()=>{if(_trayMenu is {} current)current.IsOpen=true;}));};
        _trayIcon.DoubleClick+=(_,_)=>Dispatcher.BeginInvoke(new Action(()=>{_=CaptureFromHotkeyAsync();}));
    }
    // 主动恢复工作台并作废旧覆盖层身份，迟到解码只能恢复文档，不能重建覆盖层。
    private void ShowWorkbenchFromTray()
    {
        if (_presentation.IsSelecting) return;
        var invalidatedCaptureId = _presentation.Overlay?.CaptureId;
        ShowWorkbench();
        Post(new { @event = "presentation.changed", payload = new { presentation = "workbench", reason = "user_editor", invalidatedCaptureId } });
    }
    // 映射本地打包资源，限制导航与原生桥来源，再启动 WebView2 编辑器。
    private async Task InitializeEditorAsync()
    {
        try
        {
            var assets = Path.Combine(AppContext.BaseDirectory, "web");
            if (!File.Exists(Path.Combine(assets, "index.html"))) throw new FileNotFoundException("本地编辑器未打包。请先运行构建脚本生成 editor/dist，再构建应用。");
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await Editor.EnsureCoreWebView2Async(environment);
            var core = Editor.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false; core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false; core.Settings.IsGeneralAutofillEnabled = false;
            core.SetVirtualHostNameToFolderMapping("app.screenshot.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, args) =>
            {
                if (!BridgePolicy.IsTrustedSource(args.Uri)) { args.Cancel = true; return; }
                _checkpoint.Reset();
                // 新网页拥有新的消息序列；加载失败时也不能沿用旧页的运动许可。
                FrozenBackdrop.Suspend(); _backdropGate.Reset(_presentation.Overlay?.CaptureId);
            };
            core.ProcessFailed += (_, _) => { _checkpoint.Reset(); FrozenBackdrop.Suspend(); _backdropGate.Reset(_presentation.Overlay?.CaptureId); };
            core.FrameNavigationStarting += (_, args) => args.Cancel = true;
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, args) => args.Cancel = true;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, args) =>
            {
                if (!BridgePolicy.IsTrustedSource(args.Request.Uri)) args.Response = environment.CreateWebResourceResponse(null, 403, "Forbidden", "Content-Type: text/plain");
            };
            core.WebMessageReceived += OnWebMessage;
            core.NavigationCompleted += (_, args) =>
            {
                _ready = args.IsSuccess;
                if (_presentation.Mode != PresentationMode.Overlay) StatusBar.Visibility = _ready ? Visibility.Collapsed : Visibility.Visible;
                Status.Text = args.IsSuccess ? ((_hotkeys?.State.Message??"快捷键不可用，请使用截图按钮。")+" "+_hotkeyLoadMessage+" · 图片仅在显式 AI 操作时发送") : "编辑器加载失败：" + args.WebErrorStatus;
            };
            // 虚拟主机映射不提供目录默认页，必须导航到明确的本地入口文件。
            core.Navigate(BridgePolicy.Origin + "index.html");
        }
        catch (Exception exception)
        {
            Status.Text = "启动失败：" + exception.Message;
            throw;
        }
    }
    private IntPtr WindowMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == 0x0312 && _hotkeys?.ShouldTrigger(wParam.ToInt32())==true) { handled = true; _ = CaptureFromHotkeyAsync(); }
        if (message == 0x02E0 && _presentation.Mode == PresentationMode.Overlay && !_presentation.IsSelecting && !_boundsUpdateQueued)
        {
            // WPF 先更新当前窗口的渲染 DPI，再以物理客户区重新钉住虚拟桌面边界。
            _boundsUpdateQueued = true;
            Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
            {
                _boundsUpdateQueued = false;
                if (_presentation.Overlay is { } overlay && !_presentation.IsSelecting) ApplyOverlayBounds(overlay.DesktopBounds);
            }));
        }
        return IntPtr.Zero;
    }
    // 快捷键复用本地操作门控；捕获完成后以事件将图片送给编辑器。
    private async Task CaptureFromHotkeyAsync()
        => await CaptureFromTrayAsync(CaptureRequest.Default(true) with { Backend = _captureBackend, SnapWindows = _snapWindows, SnapClientArea = _snapClientArea });

    private async Task CaptureFromTrayAsync(CaptureRequest request)
    {
        if (!_terms.IsAuthorized) return;
        if (!_ready || !_editorMounted.Task.IsCompletedSuccessfully) { ShowEditorAction("notice", "编辑器尚未就绪，请重试加载。"); return; }
        if (!_requests.TryEnter("capture.region", out var lease)) { ShowEditorNotice("正在处理另一项本地操作，请稍后重试。", error: false); return; }
        try
        {
            var image = await CaptureAsync(request);
            if (image is not null) Post(new { @event = "image.loaded", payload = image });
        }
        catch (Exception exception) { ShowEditorNotice("未能开始截图：" + exception.Message); }
        finally { lease?.Dispose(); }
    }
    private async Task CaptureCurrentFromTrayAsync()
    {
        try { await CaptureFromTrayAsync(CurrentMonitorRequest()); }
        catch (Exception error) { ShowEditorNotice("无法读取屏幕信息：" + error.Message); }
    }
    // 成功时保留冻结背景并准备隐藏的覆盖层；取消时恢复原呈现，不修改编辑文档。
    private async Task<CaptureEnvelope?> CaptureAsync(CaptureRequest request)
    {
        var trace=new CaptureDiagnostics();_captureDiagnostics=trace;
        try{await CheckEditorAsync("replace");trace.Mark("editor_checked");}catch{trace.Mark("editor_check_failed");trace.Flush();throw;}
        InvalidateCompletion();
        var wasVisible = IsVisible;
        var previousWindowState = WindowState;
        if (_presentation.Mode == PresentationMode.Workbench) RememberWorkbenchPlacement();
        _presentation.BeginCapture(); FrozenBackdrop.Suspend();
        var completed = false;
        try
        {
            var noticeDismissed = await ClearNativeNoticeAsync();
            // 先隐藏完整 HWND；已在托盘时直接取帧，可见窗口只等待本进程撤离合成，不固定睡眠。
            Hide();trace.Mark("host_hidden");
            if(wasVisible||noticeDismissed)await Task.Run(()=>Marshal.ThrowExceptionForHR(DwmFlush()),_lifetime.Token);
            trace.Mark("capture_started");
            if (!_captureBackends.TryGetValue(request.Backend, out var backend)) throw new CaptureException("invalid_capture_backend", "不支持的截图后端。");
            var frame = await backend.CaptureAsync(request, _lifetime.Token);
            if (frame is null) return null;
            var transferred=false;
            try
            {
                if(!_presentation.IsSelecting){completed=true;return null;}
                PrepareOverlay(frame);
                if(!_presentation.CompleteCapture(frame))return null;
                _backdropGate.Reset(frame.CaptureId);
                _captureHandoff.Take(frame);transferred=true;completed=true;
                trace.CaptureId=frame.CaptureId;trace.Mark("image_delivered");trace.Flush();
                _=WaitForOverlayReadyAsync(frame.CaptureId);
                return frame.ToEnvelope();
            }
            finally{if(!transferred)frame.Handoff?.Dispose();}
        }
        finally
        {
            if (!completed)
            {
                _presentation.CancelCapture();
                trace.Mark("cancelled_or_failed");trace.Flush();
                if(!_lifetime.IsCancellationRequested)RestorePresentationAfterCancel(wasVisible,previousWindowState);
            }
        }
    }
    // 使用同一个组合 WebView 和原生 Image，先完成隐藏窗口的实际客户区布局。
    private void PrepareOverlay(CapturedFrame frame)
    {
        WindowState = WindowState.Normal; WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        MinWidth = 0; MinHeight = 0; Topmost = true; ShowInTaskbar = false; Background = Brushes.Black;
        StatusBar.Visibility = Visibility.Collapsed;
        FrozenBackdrop.Source = frame.FrozenDesktop; FrozenBackdrop.Visibility = Visibility.Visible;
        ApplyOverlayBounds(frame.DesktopBounds);
        UpdateLayout();
    }
    // 始终读取实际 Win32 客户区，不使用某一显示器 DPI 推算跨屏窗口尺寸。
    private void ApplyOverlayBounds(PixelRect target)
    {
        FrozenBackdrop.Suspend();
        var handle = new WindowInteropHelper(this).Handle;
        const uint flags = 0x0010 | 0x0020; // 不抢激活；刷新无边框样式，但不显示隐藏窗口。
        if (!SetWindowPos(handle, new IntPtr(-1), target.X, target.Y, target.Width, target.Height, flags))
            throw new InvalidOperationException("无法设置截图覆盖层的物理像素边界。");
        if (!GetWindowRect(handle, out var outer) || !GetClientRect(handle, out var client)) throw new InvalidOperationException("无法读取截图覆盖层边界。");
        var origin = new NativePoint();
        if (!ClientToScreen(handle, ref origin)) throw new InvalidOperationException("无法定位截图覆盖层客户区。");
        var actualClient = new PixelRect(origin.X, origin.Y, client.Right - client.Left, client.Bottom - client.Top);
        if (actualClient != target)
        {
            var adjusted = OverlayWindowGeometry.FitClient(target, new(outer.Left, outer.Top, outer.Right - outer.Left, outer.Bottom - outer.Top), actualClient);
            if (!SetWindowPos(handle, new IntPtr(-1), adjusted.X, adjusted.Y, adjusted.Width, adjusted.Height, flags))
                throw new InvalidOperationException("无法对齐截图覆盖层客户区。");
        }
        RefreshBackdropMotion();
    }
    // 记录工作台的 DIP 布局供主动返回时恢复；覆盖层仍独立使用物理坐标。
    private void RememberWorkbenchPlacement()
    {
        if (_startingInTray) return;
        var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, ActualWidth, ActualHeight) : RestoreBounds;
        _workbenchPlacement = new(bounds, WindowState, WindowStyle, ResizeMode, Topmost, ShowInTaskbar, MinWidth, MinHeight);
    }
    // 主动进入无冻结背景的轻量编辑器，文档保持不变；加载失败时才显示原生兜底条。
    private void ShowWorkbench()
    {
        _captureHandoff.Release();_composedCaptureId=null;Opacity=1;ShowActivated=true;
        _presentation.ShowWorkbench();
        _backdropGate.Reset(null);
        FrozenBackdrop.Source = null; FrozenBackdrop.Visibility = Visibility.Collapsed;
        Background = new SolidColorBrush(Color.FromRgb(32, 32, 34));
        StatusBar.Visibility = _ready ? Visibility.Collapsed : Visibility.Visible;
        var saved = _workbenchPlacement;
        // 工具采用自己的浮层外壳，工作台也不恢复系统标题栏或保留顶部尺寸调整边框。
        WindowState = WindowState.Normal; WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize; BorderThickness = new Thickness(0);
        Topmost = saved?.Topmost ?? false; ShowInTaskbar = saved?.ShowInTaskbar ?? true;
        MinWidth = saved?.MinWidth ?? 640; MinHeight = saved?.MinHeight ?? 480;
        if (saved is not null) { Left = saved.Bounds.X; Top = saved.Bounds.Y; Width = saved.Bounds.Width; Height = saved.Bounds.Height; }
        else { var area=SystemParameters.WorkArea;Width=1100;Height=760;Left=area.Left+Math.Max(0,(area.Width-Width)/2);Top=area.Top+Math.Max(0,(area.Height-Height)/2); }
        Show(); WindowState = saved?.State ?? WindowState.Normal; Activate();
    }
    // 隐藏覆盖层并解除冻结桌面的所有宿主持有引用；不关闭 WebView 或清除文档。
    private void DismissPresentation()
    {
        _backdropGate.Reset(null); FrozenBackdrop.Suspend();
        if (_presentation.Mode == PresentationMode.Workbench) RememberWorkbenchPlacement();
        Hide(); Opacity=1;ShowActivated=true; _captureHandoff.Release(); _presentation.Dismiss(); FrozenBackdrop.Source = null;
        FrozenBackdrop.Visibility = Visibility.Collapsed; Topmost = false;
    }
    // 第一阶段在原生遮挡后显示宿主；浏览器需要可见 HWND 才能完成合成，不在这里撤挡。
    private object ReadyPresentation(string captureId)
    {
        if(_captureHandoff.IsCancelled(captureId))
        {
            if(_presentation.TryDismiss(captureId))DismissPresentation();
            return new{presentation=_presentation.Mode.ToString().ToLowerInvariant(),accepted=false,awaitingPaint=false};
        }
        var accepted=_presentation.TryPrepare(captureId);
        if(accepted&&_presentation.Overlay is {} overlay)
        {
            _composedCaptureId=null;
            if(_captureDiagnostics?.CaptureId==captureId)_captureDiagnostics.Mark("host_ready");
            ShowActivated=false;Opacity=_captureHandoff.HasVisual(captureId)?1:0;
            var owner=new WindowInteropHelper(this).Handle;_captureHandoff.KeepAbove(captureId,owner);
            Show();ApplyOverlayBounds(overlay.DesktopBounds);UpdateLayout();_captureHandoff.KeepAbove(captureId,owner);
        }
        return new{presentation=_presentation.Mode.ToString().ToLowerInvariant(),accepted,awaitingPaint=accepted,hostFrameGate=true,captureId=_presentation.Overlay?.CaptureId,viewport=accepted?ReadOverlayViewport():null};
    }
    // 模板 PART_image 是 WebView2 的公开契约；只订阅其缓冲区变化，不读取桌面像素或私有字段。
    private async Task UpdateCaptureVisualAsync(string captureId)
    {
        if(_captureDiagnostics?.CaptureId==captureId)_captureDiagnostics.Mark("frame_probe_started");
        Editor.ApplyTemplate();
        if(Editor.Template.FindName("PART_image",Editor) is not System.Windows.Controls.Image image)throw new InvalidOperationException("编辑器合成画面尚未就绪。");
        var overlay=_presentation.Overlay??throw new InvalidOperationException("截图已失效。");
        var probe=new CaptureFrameProbe(_presentation.FrozenBackdrop!,overlay.DesktopBounds,overlay.Selection,ReadOverlayViewport().Scale,SoftClayTheme.Color("mask").A);
        async Task Invalidate()
        {
            var result=await Editor.CoreWebView2.ExecuteScriptAsync("window.screenshotPresentCapture?.("+JsonSerializer.Serialize(captureId)+")");
            if(result!="true")throw new InvalidOperationException("截图呈现已失效。");
        }
        try{await CompositionFrameWaiter.WaitAsync(image,Invalidate,_lifetime.Token,probe.Accept);if(_captureDiagnostics?.CaptureId==captureId)_captureDiagnostics.Mark("frame_validated");}
        finally{if(_captureDiagnostics?.CaptureId==captureId){_captureDiagnostics.Mark("frame_probe_"+probe.LastResult,probe.RejectedFrames);_captureDiagnostics.Flush();}}
    }
    // 获取 Win32 的当前 DPI，而非仍在异步追赶的 Chromium/WPF 缩放快照。
    private PresentationViewport ReadOverlayViewport()
    {
        var handle=new WindowInteropHelper(this).Handle;var dpi=GetDpiForWindow(handle);
        if(!GetClientRect(handle,out var bounds)||dpi==0)throw new InvalidOperationException("无法读取截图客户区和缩放比例。");
        var scale=dpi/96d*Editor.ZoomFactor;
        return new((bounds.Right-bounds.Left)/scale,(bounds.Bottom-bounds.Top)/scale,scale);
    }
    // WPF 本身也要完成 DPI/尺寸更新，不能只验证浏览器传来的数学比例。
    private bool OverlayViewportMatches(PresentationViewport actual,PresentationViewport expected)
    {
        var dpi=VisualTreeHelper.GetDpi(Editor);
        return actual.Matches(expected)&&Math.Abs(dpi.DpiScaleX*Editor.ZoomFactor-expected.Scale)<.001
            &&Math.Abs(Editor.ActualWidth*dpi.DpiScaleX-expected.Width*expected.Scale)<=2
            &&Math.Abs(Editor.ActualHeight*dpi.DpiScaleY-expected.Height*expected.Scale)<=2;
    }
    // 几何匹配后提交已排队的 WPF 渲染，再次核对；旧视口只要求重试，不放行或作废截图。
    private async Task<object> PaintedPresentationAsync(string captureId,PresentationViewport viewport)
    {
        var accepted=false;PresentationViewport? expected=null;
        if(_presentation.IsPrepared(captureId)&&!_captureHandoff.IsCancelled(captureId))
        {
            expected=ReadOverlayViewport();
            if(OverlayViewportMatches(viewport,expected))
            {
                // 此时新选区仍隐藏在网页中；订阅真实源帧后再让当前选区绘制，防止恢复 HWND 时露出旧纹理。
                if(_composedCaptureId!=captureId)
                {
                    try{await UpdateCaptureVisualAsync(captureId);if(_presentation.IsPrepared(captureId))_composedCaptureId=captureId;}
                    catch(TimeoutException)
                    {
                        if(_captureDiagnostics?.CaptureId==captureId){_captureDiagnostics.Mark("frame_timeout");_captureDiagnostics.Flush();}
                        // 单次验帧超时保留当前原生遮罩，允许重试；不能在这里突变成整屏无遮罩工作台。
                    }
                }
                // 超时后必须继续遮挡；等待期间被替换的捕获也不能进入撤挡流程。
                if(_composedCaptureId==captureId&&_presentation.IsPrepared(captureId)&&!_captureHandoff.IsCancelled(captureId))
                {
                    // 当前帧已通过检查，只等已排队的渲染，不额外等待整个界面进入空闲状态。
                    await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render,_lifetime.Token);
                    await Task.Run(()=>Marshal.ThrowExceptionForHR(DwmFlush()),_lifetime.Token);
                    expected=ReadOverlayViewport();
                    if(_composedCaptureId==captureId&&OverlayViewportMatches(viewport,expected)&&!_captureHandoff.IsCancelled(captureId)&&_presentation.TryAcceptPainted(captureId))
                    {
                        Opacity=1;ShowActivated=true;_captureHandoff.Release(captureId);Activate();accepted=true;
                        RefreshBackdropMotion();
                        if(_captureDiagnostics?.CaptureId==captureId){_captureDiagnostics.Mark("handoff_released");_captureDiagnostics.Flush();}
                    }
                }
            }
        }
        if(_captureHandoff.IsCancelled(captureId)&&_presentation.TryDismiss(captureId))DismissPresentation();
        var awaitingPaint=!accepted&&_presentation.IsPrepared(captureId);
        return new{presentation=_presentation.Mode.ToString().ToLowerInvariant(),accepted,awaitingPaint,viewport=expected,captureId=_presentation.Overlay?.CaptureId};
    }
    // 前端解码或布局失败时不永久隐藏应用；计时器只能回收自己等待的 captureId。
    private async Task WaitForOverlayReadyAsync(string captureId)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(15), _lifetime.Token);
            while (!_lifetime.IsCancellationRequested && _presentation.PendingCaptureId == captureId)
            {
                if (_presentation.TryExpireReady(captureId))
                {
                    ShowWorkbench();
                    Status.Text = "选区编辑器未能及时就绪，已保留图片。可重试截图或继续编辑。";
                    Post(new { @event = "presentation.changed", payload = new { presentation = "workbench", reason = "overlay_timeout", timedOutCaptureId = captureId } });
                    return;
                }
                // 正在重新选择时推迟旧帧的回收；新截图提交后其 ID 会自然淘汰此计时器。
                await Task.Delay(1000, _lifetime.Token);
            }
        }
        catch (OperationCanceledException) { }
    }
    // 区域选择取消后恢复之前的工作台、覆盖层或隐藏状态，保留原有冻结背景。
    private void RestorePresentationAfterCancel(bool wasVisible, WindowState previousWindowState)
    {
        if (_presentation.Mode == PresentationMode.Workbench)
        {
            if (wasVisible) { ShowWorkbench(); WindowState = previousWindowState; }
            else { FrozenBackdrop.Source = null; Hide(); }
        }
        else if (_presentation.Overlay is { } overlay)
        {
            FrozenBackdrop.Source = _presentation.FrozenBackdrop; FrozenBackdrop.Visibility = Visibility.Visible;
            ApplyOverlayBounds(overlay.DesktopBounds);
            if (wasVisible) { Show(); ApplyOverlayBounds(overlay.DesktopBounds); Activate(); }
        }
        else { FrozenBackdrop.Source = null; Hide(); }
        RefreshBackdropMotion();
    }
    // 校验来源和请求结构，取得对应门控，并以相同请求 ID 返回结果或错误。
    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!BridgePolicy.IsTrustedSource(args.Source)) return;
        string? id = null;
        IDisposable? lease = null;
        try
        {
            var raw = args.WebMessageAsJson;
            if (raw.Length > BridgePolicy.MaxDocumentBytes * 4L / 3 + 4096) throw new InvalidOperationException("请求数据过大。");
            using var document = JsonDocument.Parse(raw, new JsonDocumentOptions { MaxDepth = 64 });
            var request = document.RootElement;
            if (!request.TryGetProperty("id", out var requestId) || requestId.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(id = requestId.GetString()) || id.Length > 128) return;
            var method = RequiredString(request, "method");
            if (!_requests.TryEnter(method, out lease))
            {
                Failure(id, "busy", method is "ai.ocr" or "ai.translate" or "ai.translateImage" ? "已有 AI 请求正在处理，请稍后重试。你仍可导入、保存或复制图片。" : "正在处理另一项本地操作，请稍后重试。");
                return;
            }
            var payload = request.TryGetProperty("payload", out var item) ? item : default;
            var result = await ExecuteAsync(method, payload);
            Post(new { id, ok = true, result });
        }
        catch (CaptureException exception) { if (id is not null) Failure(id, exception.Code, exception.Message); }
        catch (AiProviderException exception) { if (id is not null) Failure(id, exception.Code, exception.Message); }
        catch (LocalOcrException exception) { if (id is not null) Failure(id, exception.Code, exception.Message); }
        catch (SnapshotStoreException exception) { if (id is not null) Failure(id, exception.Code, exception.Message); }
        catch (OperationCanceledException) { if (id is not null) Failure(id, "cancelled", "操作已取消。"); }
        catch (Exception exception) { if (id is not null) Failure(id, "operation_failed", exception is JsonException ? "请求格式无效。" : exception.Message); }
        finally { lease?.Dispose(); }
    }
    // 仅允许协议列明的命令；文件、剪贴板、捕获及密钥相关操作留在原生进程。
    private async Task<object?> ExecuteAsync(string method, JsonElement payload)
    {
        _terms.RequireAccepted();
        switch (method)
        {
            case "app.info": return new { version = typeof(App).Assembly.GetName().Version?.ToString(3) ?? "unknown", platform = "windows", presentation = _presentation.Mode.ToString().ToLowerInvariant(), capture = new { backend = _captureBackend, colorMode = "sdr", supportsHdr = false, availableBackends = new[] { "wgc", "gdi" }, targets = new[] { "desktop", "monitor", "window" }, availability = "checked-on-capture" }, capabilities = new[] { "image.open", "image.paste", "capture.adjust", "capture.screen", "capture.region", "capture.current", "capture.monitors", "capture.settings", "capture.configure", "hotkey.read", "hotkey.configure", "image.save", "image.copy", "image.pin", "text.copy", "project.open", "project.save", "ai.ocr", "ai.translate", "ai.translateImage", "ocr.local", "ocr.cancel", "ocr.status", "ai.cancel", "ai.usage", "ai.test", "recovery.list", "recovery.load", "recovery.delete", "recovery.usage", "recovery.deleteMany", "presentation.workbench", "presentation.editor", "presentation.dismiss", "presentation.ready", "presentation.background", "presentation.complete", "document.preserve", "app.terms" } };
            case "document.preserve": await CheckEditorAsync("replace"); return new { checkedState = true, saved = false };
            case "image.open": await CheckEditorAsync("replace"); return NativeImages.Open(this);
            case "image.paste": await CheckEditorAsync("replace"); return NativeImages.Paste();
            case "capture.monitors": return ReadCaptureMonitors();
            case "capture.current": return await CaptureAsync(CurrentMonitorRequest());
            case "capture.screen": return await CaptureAsync(ParseCaptureRequest(payload, false));
            case "capture.region": return await CaptureAsync(ParseCaptureRequest(payload, true));
            case "capture.adjust":
                var area = payload.GetProperty("selection");
                // 同一冻结桌面的裁剪只保持当前姿态；清零位移和暗角会让整个画面闪一下。
                _backdropAdjusting = true; RefreshBackdropMotion();
                try { return await _presentation.AdjustAsync(RequiredString(payload, "captureId"), new PixelRect(area.GetProperty("x").GetInt32(), area.GetProperty("y").GetInt32(), area.GetProperty("width").GetInt32(), area.GetProperty("height").GetInt32()),_lifetime.Token); }
                finally { _backdropAdjusting = false; RefreshBackdropMotion(); }
            case "hotkey.read": return _hotkeys?.State??new HotkeyStatus(HotkeyBinding.Default,false,false,"快捷键尚未就绪。");
            case "hotkey.configure":
                if(_hotkeys is null)throw new InvalidOperationException("快捷键尚未就绪。");
                var hotkey=_hotkeys.Apply(HotkeyBinding.Parse(payload),_hotkeyStore.Save);Status.Text=hotkey.Message;return hotkey;
            case "capture.settings": return new { backend = _captureBackend,snapWindows=_snapWindows,windowArea=_snapClientArea?"client":"window" };
            case "capture.configure":
                var backend = RequiredString(payload, "backend");
                if (backend is not ("wgc" or "gdi")) throw new CaptureException("invalid_capture_backend", "请选择 WGC 或 GDI 兼容后端。");
                var settingsRequest=CaptureRequest.Parse(payload,true);
                _captureBackend = backend;
                if(payload.TryGetProperty("snapWindows",out _))_snapWindows=settingsRequest.SnapWindows;
                if(payload.TryGetProperty("windowArea",out _))_snapClientArea=settingsRequest.SnapClientArea;
                return new { backend = _captureBackend,snapWindows=_snapWindows,windowArea=_snapClientArea?"client":"window" };
            case "ocr.status": return await Task.Run(_localOcr.GetStatus, _lifetime.Token);
            case "ocr.local": return await RunInferenceAsync(payload, async token => await RecognizeLocalAsync(RequiredString(payload, "imageDataUrl"), token));
            case "ai.cancel": return new { cancelled = _inferenceTasks.Cancel(RequiredString(payload,"taskId")) };
            case "ai.test": return await RunInferenceAsync(payload,async token=>await _ai.ProbeAsync(RequiredString(payload,"providerId"),RequiredString(payload,"kind"),token));
            case "ai.usage": return new { items = _ai.ReadUsage() };
            case "ocr.cancel": _ocrCancellation?.Cancel(); return new { cancelled = _ocrCancellation is not null };
            case "recovery.usage": return await RunRecoveryAsync(store=>store.GetUsageAsync(_lifetime.Token));
            case "recovery.deleteMany":
                if(!payload.TryGetProperty("documentIds",out var ids)||ids.ValueKind!=JsonValueKind.Array||ids.GetArrayLength()>1000)throw new InvalidOperationException("恢复记录列表无效。");
                var selectedIds=new List<string>();foreach(var id in ids.EnumerateArray()){if(id.ValueKind!=JsonValueKind.String)throw new InvalidOperationException("恢复文档标识无效。");selectedIds.Add(id.GetString()!);}
                return await RunRecoveryAsync(store=>store.DeleteManyAsync(selectedIds,_lifetime.Token));
            case "recovery.save": throw new InvalidOperationException("自动保存已关闭，请使用手动保存项目。");
            case "recovery.list": return new { items = await RunRecoveryAsync(store => store.ListAsync(_lifetime.Token)) };
            case "recovery.load": return await RunRecoveryAsync(store => store.LoadAsync(RequiredString(payload, "documentId"), _lifetime.Token));
            case "recovery.delete": return await RunRecoveryAsync(store => store.DeleteAsync(RequiredString(payload, "documentId"), _lifetime.Token));
            case "presentation.editor":
            case "presentation.workbench":
                var workbenchCaptureId = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("captureId", out _) ? RequiredString(payload, "captureId") : null;
                var accepted = _presentation.TryShowWorkbench(workbenchCaptureId);
                if (accepted) ShowWorkbench();
                return new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted, captureId = _presentation.Overlay?.CaptureId };
            case "presentation.dismiss":
                var dismissCaptureId = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("captureId", out _) ? RequiredString(payload, "captureId") : null;
                if (!_presentation.Matches(dismissCaptureId)) return new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted = false, captureId = _presentation.Overlay?.CaptureId };
                var dismissSequence = _completionSequence;
                await CheckEditorAsync("close");
                var wasWorkbench = _presentation.Mode == PresentationMode.Workbench;
                var dismissed = dismissSequence == _completionSequence && _presentation.TryDismiss(dismissCaptureId);
                if (dismissed) { if (wasWorkbench) RememberWorkbenchPlacement(); DismissPresentation(); }
                return new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted = dismissed, captureId = _presentation.Overlay?.CaptureId };
            case "presentation.ready": return ReadyPresentation(RequiredString(payload, "captureId"));
            case "presentation.background": return UpdateBackdropMotion(payload);
            case "presentation.painted":
                var viewport=payload.GetProperty("viewport");
                return await PaintedPresentationAsync(RequiredString(payload,"captureId"),new(viewport.GetProperty("width").GetDouble(),viewport.GetProperty("height").GetDouble(),viewport.GetProperty("scale").GetDouble()));
            case "presentation.complete": return await CompleteEditingAsync(payload);
            case "image.save": return NativeImages.Save(this, RequiredString(payload, "dataUrl"), OptionalString(payload, "suggestedName"));
            case "text.copy": return NativeImages.CopyText(RequiredString(payload, "text"));
            case "image.copy":
                // 完整解码离开 UI 线程，真正的剪贴板写入仍回到原生 STA 线程。
                var copyBitmap = await Task.Run(() => NativeImages.DecodePng(RequiredString(payload, "dataUrl")), _lifetime.Token);
                _lifetime.Token.ThrowIfCancellationRequested();
                return NativeImages.Copy(copyBitmap);
            case "image.pin": return await PinImageAsync(payload);
            case "project.open": await CheckEditorAsync("replace"); return NativeImages.OpenProject(this);
            case "project.save": return NativeImages.SaveProject(this, payload.GetProperty("document"), OptionalString(payload, "suggestedName"));
            case "settings.read": return await _ai.ReadSettingsAsync(_lifetime.Token);
            case "settings.configure":
                // 所有设置在同一原生浮卡内切换，文字工具只指定服务页，不再套一层网页设置。
                OpenSettingsWindow(OptionalString(payload, "section") ?? "capture");
                return await _ai.ReadSettingsAsync(_lifetime.Token);
            case "app.terms": new TermsWindow(_terms, reviewOnly: true) { Owner = this }.ShowDialog(); return new { viewed = true };
            case "app.updateReady": _editorMounted.TrySetResult(); MarkUpdateHealthy(); return new { ready = true };
            case "ai.ocr": return await RunInferenceAsync(payload, async token => await _ai.OcrAsync(RequiredString(payload, "providerId"), RequiredString(payload, "imageDataUrl"),OptionalString(payload,"providerRevision"), token));
            case "ai.translateImage": return await RunInferenceAsync(payload, async token => await _ai.TranslateImageAsync(RequiredString(payload, "providerId"), RequiredString(payload, "imageDataUrl"), OptionalString(payload, "providerRevision"), token));
            case "ai.translate": return await RunInferenceAsync(payload, async token =>
            {
                var purpose = OptionalString(payload, "purpose");
                if (purpose is not (null or "image")) throw new InvalidOperationException("不支持此翻译用途。");
                return purpose == "image"
                    ? await _ai.TranslateImageTextAsync(RequiredString(payload, "providerId"), RequiredString(payload, "text"), RequiredString(payload, "targetLanguage"), OptionalString(payload, "providerRevision"), token)
                    : await _ai.TranslateAsync(RequiredString(payload, "providerId"), RequiredString(payload, "text"), RequiredString(payload, "targetLanguage"), OptionalString(payload, "providerRevision"), token);
            });
            default: throw new InvalidOperationException("不支持的原生命令：" + method);
        }
    }
    private static string RequiredString(JsonElement value, string name) => OptionalString(value, name) ?? throw new InvalidOperationException("缺少请求字段：" + name);
    private static string? OptionalString(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
    private void Failure(string id, string code, string message) => Post(new { id, ok = false, error = new { code, message } });
    private void Post(object response)
    {
        if (!_lifetime.IsCancellationRequested && Editor.CoreWebView2 is { } core && BridgePolicy.IsTrustedSource(core.Source)) core.PostWebMessageAsJson(JsonSerializer.Serialize(response, _json));
    }
}
