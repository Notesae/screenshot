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
    private readonly AiService _ai = new();
    private readonly IReadOnlyDictionary<string, ICaptureBackend> _captureBackends = new Dictionary<string, ICaptureBackend>
    {
        ["wgc"] = new WgcCaptureBackend(), ["gdi"] = new GdiCaptureBackend()
    };
    private readonly CancellationTokenSource _lifetime = new();
    private readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly RequestGate _requests = new();
    private readonly CapturePresentationState _presentation = new();
    private WorkbenchPlacement? _workbenchPlacement;
    private bool _boundsUpdateQueued; // 合并 DPI 更新后的边界校正，避免递归窗口消息。
    private bool _ready;
    private HotkeyManager? _hotkeys;
    private string _hotkeyLoadMessage="";
    private readonly HotkeySettingsStore _hotkeyStore=new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Screenshot","capture-hotkey.json"));
    private HwndSource? _source;
    private System.Windows.Forms.NotifyIcon? _trayIcon; // 隐藏后仍可恢复同一 WebView 中的内存文档。
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
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
        Editor.DefaultBackgroundColor = System.Drawing.Color.Transparent;
        Loaded += async (_, _) => await InitializeEditorAsync();
        SourceInitialized += (_, _) =>
        {
            _terms.RequireAccepted();
            var handle = new WindowInteropHelper(this).Handle;
            _source = HwndSource.FromHwnd(handle); _source.AddHook(WindowMessage);
            var loaded=_hotkeyStore.Load();_hotkeyLoadMessage=loaded.Message;
            _hotkeys=new(new WindowsHotkeyRegistration(handle));_hotkeys.Apply(loaded.Binding,_=>{});
            InitializeTray();
        };
        Closed += (_, _) =>
        {
            _lifetime.Cancel();
            FrozenBackdrop.Source = null; _presentation.Dismiss();
            if (_trayIcon is { } tray)
            {
                tray.Visible = false; tray.ContextMenuStrip?.Dispose(); tray.Dispose(); _trayIcon = null;
            }
            _hotkeys?.Dispose();
            _source?.RemoveHook(WindowMessage); Editor.Dispose(); _ai.Dispose(); _updateLogin.Dispose(); DisposeLocalFeatures(); _lifetime.Dispose();
        };
    }
    // 托盘仅提供恢复、复用现有门控截图和退出，不创建第二个编辑器实例。
    private void ShowTerms(object sender, RoutedEventArgs e) => new TermsWindow(_terms, reviewOnly: true) { Owner = this }.ShowDialog();
    private void InitializeTray()
    {
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("打开工作台", null, (_, _) => Dispatcher.BeginInvoke(new Action(ShowWorkbenchFromTray)));
        menu.Items.Add("区域截图", null, (_, _) => Dispatcher.BeginInvoke(new Action(() => { _ = CaptureFromHotkeyAsync(); })));
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => Dispatcher.BeginInvoke(new Action(Close)));
        _trayIcon = new System.Windows.Forms.NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application, Text = "Screenshot · 截图工作台", ContextMenuStrip = menu, Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => Dispatcher.BeginInvoke(new Action(ShowWorkbenchFromTray));
    }
    // 主动恢复工作台并作废旧覆盖层身份，迟到解码只能恢复文档，不能重建覆盖层。
    private void ShowWorkbenchFromTray()
    {
        if (_presentation.IsSelecting) return;
        var invalidatedCaptureId = _presentation.Overlay?.CaptureId;
        ShowWorkbench();
        Post(new { @event = "presentation.changed", payload = new { presentation = "workbench", reason = "user_workbench", invalidatedCaptureId } });
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
            core.NavigationStarting += (_, args) => { if (!BridgePolicy.IsTrustedSource(args.Uri)) args.Cancel = true; };
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
                Status.Text = args.IsSuccess ? ((_hotkeys?.State.Message??"快捷键不可用，请使用截图按钮。")+" "+_hotkeyLoadMessage+" · 图片仅在显式 AI 操作时发送") : "编辑器加载失败：" + args.WebErrorStatus;
            };
            // 虚拟主机映射不提供目录默认页，必须导航到明确的本地入口文件。
            core.Navigate(BridgePolicy.Origin + "index.html");
        }
        catch (Exception exception)
        {
            Status.Text = "启动失败：" + exception.Message;
            MessageBox.Show(this, exception.Message + "\n应用需要 Microsoft Edge WebView2 Runtime。", "无法启动编辑器", MessageBoxButton.OK, MessageBoxImage.Error);
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
    {
        if (!_terms.IsAuthorized || !_ready || !_requests.TryEnter("capture.region", out var lease)) return;
        try
        {
            var image = await CaptureAsync(CaptureRequest.Default(true) with { Backend = _captureBackend, SnapWindows=_snapWindows, SnapClientArea=_snapClientArea });
            if (image is not null) Post(new { @event = "image.loaded", payload = image });
        }
        catch (Exception exception) { Status.Text = "截图失败：" + exception.Message; }
        finally { lease?.Dispose(); }
    }
    // 成功时保留冻结背景并准备隐藏的覆盖层；取消时恢复原呈现，不修改编辑文档。
    private async Task<CaptureEnvelope?> CaptureAsync(CaptureRequest request)
    {
        var wasVisible = IsVisible;
        var previousWindowState = WindowState;
        if (_presentation.Mode == PresentationMode.Workbench) RememberWorkbenchPlacement();
        _presentation.BeginCapture();
        var completed = false;
        Hide();
        try
        {
            // 等待桌面合成器移除宿主画面，避免应用自身进入截图。
            await Task.Delay(180, _lifetime.Token);
            if (!_captureBackends.TryGetValue(request.Backend, out var backend)) throw new CaptureException("invalid_capture_backend", "不支持的截图后端。");
            var frame = await backend.CaptureAsync(request, _lifetime.Token);
            if (frame is null) return null;
            if (!_presentation.IsSelecting) { completed = true; return null; }
            PrepareOverlay(frame);
            if (!_presentation.CompleteCapture(frame)) return null;
            completed = true;
            _ = WaitForOverlayReadyAsync(frame.CaptureId);
            return frame.ToEnvelope();
        }
        finally
        {
            if (!completed)
            {
                _presentation.CancelCapture();
                if (!_lifetime.IsCancellationRequested) RestorePresentationAfterCancel(wasVisible, previousWindowState);
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
    }
    // 记录工作台的 DIP 布局供主动返回时恢复；覆盖层仍独立使用物理坐标。
    private void RememberWorkbenchPlacement()
    {
        var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, ActualWidth, ActualHeight) : RestoreBounds;
        _workbenchPlacement = new(bounds, WindowState, WindowStyle, ResizeMode, Topmost, ShowInTaskbar, MinWidth, MinHeight);
    }
    // 仅用户主动进入高级工作台时恢复窗口样式和尺寸，编辑器文档保持不变。
    private void ShowWorkbench()
    {
        _presentation.ShowWorkbench();
        FrozenBackdrop.Source = null; FrozenBackdrop.Visibility = Visibility.Collapsed;
        Background = new SolidColorBrush(Color.FromRgb(243, 244, 246));
        StatusBar.Visibility = Visibility.Visible;
        var saved = _workbenchPlacement;
        WindowState = WindowState.Normal; WindowStyle = saved?.Style ?? WindowStyle.SingleBorderWindow;
        ResizeMode = saved?.ResizeMode ?? ResizeMode.CanResize;
        Topmost = saved?.Topmost ?? false; ShowInTaskbar = saved?.ShowInTaskbar ?? true;
        MinWidth = saved?.MinWidth ?? 1000; MinHeight = saved?.MinHeight ?? 680;
        if (saved is not null) { Left = saved.Bounds.X; Top = saved.Bounds.Y; Width = saved.Bounds.Width; Height = saved.Bounds.Height; }
        Show(); WindowState = saved?.State ?? WindowState.Normal; Activate();
    }
    // 隐藏覆盖层并解除冻结桌面的所有宿主持有引用；不关闭 WebView 或清除文档。
    private void DismissPresentation()
    {
        if (_presentation.Mode == PresentationMode.Workbench) RememberWorkbenchPlacement();
        Hide(); _presentation.Dismiss(); FrozenBackdrop.Source = null;
        FrozenBackdrop.Visibility = Visibility.Collapsed; Topmost = false;
    }
    // 只有当前 captureId 对应的紧凑界面已完成布局，才显示覆盖层，避免工作台闪现。
    private object ReadyPresentation(string captureId)
    {
        var accepted = _presentation.TryAcceptReady(captureId);
        if (accepted && _presentation.Overlay is { } overlay)
        {
            Show(); ApplyOverlayBounds(overlay.DesktopBounds); UpdateLayout(); Activate();
        }
        return new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted, captureId = _presentation.Overlay?.CaptureId };
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
                    Status.Text = "选区编辑器未能及时就绪，已恢复工作台。可重新截图或检查编辑器状态。";
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
                Failure(id, "busy", method is "ai.ocr" or "ai.translate" ? "已有 AI 请求正在处理，请稍后重试。你仍可导入、保存或复制图片。" : "正在处理另一项本地操作，请稍后重试。");
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
            case "app.info": return new { version = typeof(App).Assembly.GetName().Version?.ToString(3) ?? "unknown", platform = "windows", presentation = _presentation.Mode.ToString().ToLowerInvariant(), capture = new { backend = _captureBackend, colorMode = "sdr", supportsHdr = false, availableBackends = new[] { "wgc", "gdi" }, targets = new[] { "desktop", "monitor", "window" }, availability = "checked-on-capture" }, capabilities = new[] { "image.open", "image.paste", "capture.screen", "capture.region", "capture.current", "capture.monitors", "capture.settings", "capture.configure", "hotkey.read", "hotkey.configure", "image.save", "image.copy", "text.copy", "project.open", "project.save", "ai.ocr", "ai.translate", "ocr.local", "ocr.cancel", "ocr.status", "ai.cancel", "ai.usage", "ai.test", "recovery.save", "recovery.list", "recovery.load", "recovery.delete", "recovery.usage", "recovery.deleteMany", "presentation.workbench", "presentation.dismiss", "presentation.ready" } };
            case "image.open": return NativeImages.Open(this);
            case "image.paste": return NativeImages.Paste();
            case "capture.monitors": return ReadCaptureMonitors();
            case "capture.current": return await CaptureAsync(CurrentMonitorRequest());
            case "capture.screen": return await CaptureAsync(ParseCaptureRequest(payload, false));
            case "capture.region": return await CaptureAsync(ParseCaptureRequest(payload, true));
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
            case "recovery.save": return await SaveRecoveryAsync(payload);
            case "recovery.list": return new { items = await RunRecoveryAsync(store => store.ListAsync(_lifetime.Token)) };
            case "recovery.load": return await RunRecoveryAsync(store => store.LoadAsync(RequiredString(payload, "documentId"), _lifetime.Token));
            case "recovery.delete": return await RunRecoveryAsync(store => store.DeleteAsync(RequiredString(payload, "documentId"), _lifetime.Token));
            case "presentation.workbench":
                var workbenchCaptureId = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("captureId", out _) ? RequiredString(payload, "captureId") : null;
                var accepted = _presentation.TryShowWorkbench(workbenchCaptureId);
                if (accepted) ShowWorkbench();
                return new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted, captureId = _presentation.Overlay?.CaptureId };
            case "presentation.dismiss":
                var dismissCaptureId = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("captureId", out _) ? RequiredString(payload, "captureId") : null;
                var wasWorkbench = _presentation.Mode == PresentationMode.Workbench;
                var dismissed = _presentation.TryDismiss(dismissCaptureId);
                if (dismissed) { if (wasWorkbench) RememberWorkbenchPlacement(); DismissPresentation(); }
                return new { presentation = _presentation.Mode.ToString().ToLowerInvariant(), accepted = dismissed, captureId = _presentation.Overlay?.CaptureId };
            case "presentation.ready": return ReadyPresentation(RequiredString(payload, "captureId"));
            case "image.save": return NativeImages.Save(this, RequiredString(payload, "dataUrl"), OptionalString(payload, "suggestedName"));
            case "text.copy": return NativeImages.CopyText(RequiredString(payload, "text"));
            case "image.copy": return NativeImages.Copy(RequiredString(payload, "dataUrl"));
            case "project.open": return NativeImages.OpenProject(this);
            case "project.save": return NativeImages.SaveProject(this, payload.GetProperty("document"), OptionalString(payload, "suggestedName"));
            case "settings.read": return await _ai.ReadSettingsAsync(_lifetime.Token);
            case "settings.configure": new ProviderSettingsWindow(_ai, SaveBeforeUpdateAsync, _updateLogin) { Owner = this }.ShowDialog(); return await _ai.ReadSettingsAsync(_lifetime.Token);
            case "app.updateReady": MarkUpdateHealthy(); return new { ready = true };
            case "ai.ocr": return await RunInferenceAsync(payload, async token => await _ai.OcrAsync(RequiredString(payload, "providerId"), RequiredString(payload, "imageDataUrl"),OptionalString(payload,"providerRevision"), token));
            case "ai.translate": return await RunInferenceAsync(payload, async token => await _ai.TranslateAsync(RequiredString(payload, "providerId"), RequiredString(payload, "text"), RequiredString(payload, "targetLanguage"),OptionalString(payload,"providerRevision"), token));
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
