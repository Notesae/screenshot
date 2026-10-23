using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace Screenshot.App;

/// <summary>独立持有成品位图的桌面钉图；移动、缩放和置顶不修改编辑文档或图片像素。</summary>
internal sealed class PinnedImageWindow : SoftClayWindow
{
    // 外壳占用固定 DIP，100% 图片则按当前显示器 DPI 对齐真实像素。
    private const double FrameWidth = 40, FrameHeight = 82;
    private readonly Image _image;
    private readonly ScrollViewer _viewport;
    private readonly Button _zoomButton, _pinButton;
    private readonly int _pixelWidth, _pixelHeight;
    private readonly System.Drawing.Rectangle _initialArea;
    private double _zoom = 1;
    private bool _placed, _closed;
    internal long PixelCount => (long)_pixelWidth * _pixelHeight;

    /// <summary>复用原生浮卡材质、按压和退场；窗口无 Owner，取消置顶后按普通窗口参与桌面层级。</summary>
    internal PinnedImageWindow(BitmapSource bitmap, System.Drawing.Rectangle workArea)
    {
        _pixelWidth = bitmap.PixelWidth; _pixelHeight = bitmap.PixelHeight; _initialArea = workArea;
        FontFamily = SoftClayTheme.Font; FontSize = SoftClayTheme.Number("type", "body");
        WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.Manual;
        AllowsTransparency = true; Background = Brushes.Transparent;
        ShowInTaskbar = true; Topmost = true; Width = 300; Height = 240; Opacity = 0;
        var content = new Grid();
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition());
        var toolbar = new Grid { Margin = new Thickness(8), Background = Brushes.Transparent };
        toolbar.ColumnDefinitions.Add(new ColumnDefinition());
        toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var grip = new TextBlock { Text = "⠿", FontSize = 22, Foreground = SoftClayTheme.Brush("muted"), VerticalAlignment = VerticalAlignment.Center, Cursor = Cursors.SizeAll, ToolTip = "拖动移动钉图；滚轮缩放，双击图片恢复 100%" };
        toolbar.Children.Add(grip); toolbar.MouseLeftButtonDown += DragImage;
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        Grid.SetColumn(actions, 1); toolbar.Children.Add(actions);
        actions.Children.Add(ImageButton("缩小", "M5 12H19", () => SetZoom(_zoom / 1.2)));
        _zoomButton = new Button { Content = "100%", Width = 54, Height = 30, MinHeight = 30, Padding = new Thickness(2), Margin = new Thickness(3, 0, 0, 0), Style = SoftClayTheme.ButtonStyle(), ToolTip = "恢复 100%" };
        AutomationProperties.SetName(_zoomButton, "恢复原始大小"); _zoomButton.Click += (_, _) => SetZoom(1); actions.Children.Add(_zoomButton);
        actions.Children.Add(ImageButton("放大", "M5 12H19 M12 5V19", () => SetZoom(_zoom * 1.2)));
        _pinButton = ImageButton("取消置顶", "M16 3H8 M9 3V9L5 13V15H19V13L15 9V3 M12 15V22", ToggleTopmost);
        actions.Children.Add(_pinButton);
        actions.Children.Add(ImageButton("关闭钉图", "M6 6L18 18 M18 6L6 18", Close));
        content.Children.Add(toolbar);
        _image = new Image { Source = bitmap, Stretch = Stretch.Fill, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Cursor = Cursors.SizeAll, SnapsToDevicePixels = true };
        RenderOptions.SetBitmapScalingMode(_image, BitmapScalingMode.HighQuality);
        AutomationProperties.SetName(_image, "桌面钉图");
        _image.MouseLeftButtonDown += DragImage;
        _viewport = new ScrollViewer { Content = _image, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center, Background = SoftClayTheme.Brush("well"), Margin = new Thickness(8, 0, 8, 8), Focusable = false };
        _viewport.PreviewMouseWheel += (_, args) => { SetZoom(_zoom * Math.Pow(1.2, Math.Clamp(args.Delta / 120.0, -3, 3))); args.Handled = true; };
        Grid.SetRow(_viewport, 1); content.Children.Add(_viewport);
        Content = new SoftClayPopupSurface { Style = (Style)FindResource(typeof(SoftClayPopupSurface)), Margin = new Thickness(12), Padding = new Thickness(0), Content = content };
        UpdateTopmostState();
        Loaded += (_, _) =>
        {
            var dpi = VisualTreeHelper.GetDpi(this);
            SetZoom(Math.Min(1, Math.Min((_initialArea.Width - FrameWidth * dpi.DpiScaleX - 24) / _pixelWidth, (_initialArea.Height - FrameHeight * dpi.DpiScaleY - 24) / _pixelHeight)));
            _placed = true; Opacity = 1;
        };
        PreviewKeyDown += (_, args) =>
        {
            if (args.Key == Key.Escape) Close();
            else if (args.Key is Key.Add or Key.OemPlus) SetZoom(_zoom * 1.2);
            else if (args.Key is Key.Subtract or Key.OemMinus) SetZoom(_zoom / 1.2);
            else if (args.Key is Key.D0 or Key.NumPad0) SetZoom(1);
            else if (args.Key == Key.P) ToggleTopmost();
            else return;
            args.Handled = true;
        };
    }

    /// <summary>图标与其他原生控件共用按压模板，保留清晰的中文可访问名称。</summary>
    private Button ImageButton(string label, string geometry, Action action)
    {
        var path = new Path { Data = Geometry.Parse(geometry), Stroke = SoftClayTheme.Brush("ink"), StrokeThickness = 1.8, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round };
        var icon = new Canvas { Width = 24, Height = 24 }; icon.Children.Add(path);
        var button = new Button { Content = new Viewbox { Width = 18, Height = 18, Child = icon }, Width = 30, Height = 30, MinHeight = 30, Padding = new Thickness(4), Margin = new Thickness(3, 0, 0, 0), Style = SoftClayTheme.ButtonStyle(), ToolTip = label };
        AutomationProperties.SetName(button, label); button.Click += (_, _) => action(); return button;
    }

    /// <summary>拖动正文或工具栏空白移动窗口；按钮保持自身输入，双击图片只恢复缩放。</summary>
    private void DragImage(object sender, MouseButtonEventArgs args)
    {
        if (args.Handled || args.ChangedButton != MouseButton.Left) return;
        args.Handled = true;
        if (args.ClickCount == 2 && ReferenceEquals(sender, _image)) { SetZoom(1); return; }
        if (Mouse.LeftButton == MouseButtonState.Pressed) DragMove();
    }

    /// <summary>缩放只改变显示尺寸；超出屏幕时滚动查看，同时将关闭与置顶控件留在工作区内。</summary>
    private void SetZoom(double value)
    {
        if (_closed || !double.IsFinite(value)) return;
        var handle = new WindowInteropHelper(this).Handle;
        var area = Forms.Screen.FromHandle(handle).WorkingArea;
        var dpi = VisualTreeHelper.GetDpi(this);
        // Width/Height 会同步更新 HWND；先保留旧中心，避免放大时窗口只向右下角增长。
        GetWindowRect(handle, out var previous);
        var centerX = (_viewport.HorizontalOffset + _viewport.ViewportWidth / 2) / _zoom;
        var centerY = (_viewport.VerticalOffset + _viewport.ViewportHeight / 2) / _zoom;
        _zoom = Math.Clamp(value, .05, 4);
        _image.Width = _pixelWidth * _zoom / dpi.DpiScaleX; _image.Height = _pixelHeight * _zoom / dpi.DpiScaleY;
        Width = Math.Min(Math.Max(260, _image.Width + FrameWidth), (area.Width - 24) / dpi.DpiScaleX);
        Height = Math.Min(Math.Max(130, _image.Height + FrameHeight), (area.Height - 24) / dpi.DpiScaleY);
        var width = (int)Math.Ceiling(Width * dpi.DpiScaleX); var height = (int)Math.Ceiling(Height * dpi.DpiScaleY);
        var x = _placed ? (previous.Left + previous.Right - width) / 2 : _initialArea.Left + (_initialArea.Width - width) / 2;
        var y = _placed ? (previous.Top + previous.Bottom - height) / 2 : _initialArea.Top + (_initialArea.Height - height) / 2;
        SetWindowPos(handle, 0, Math.Clamp(x, area.Left + 12, Math.Max(area.Left + 12, area.Right - width - 12)), Math.Clamp(y, area.Top + 12, Math.Max(area.Top + 12, area.Bottom - height - 12)), width, height, 0x14);
        UpdateLayout();
        if (_placed) { _viewport.ScrollToHorizontalOffset(Math.Max(0, centerX * _zoom - _viewport.ViewportWidth / 2)); _viewport.ScrollToVerticalOffset(Math.Max(0, centerY * _zoom - _viewport.ViewportHeight / 2)); }
        _zoomButton.Content = $"{_zoom:P0}";
        AutomationProperties.SetHelpText(_zoomButton, $"当前缩放 {_zoom:P0}，点击恢复原始大小");
    }

    private void ToggleTopmost() { Topmost = !Topmost; UpdateTopmostState(); }
    // 实际窗口层级、按钮选中样式和可访问名称保持一致。
    private void UpdateTopmostState()
    {
        Title = Topmost ? "截图钉图 · 已置顶" : "截图钉图 · 未置顶";
        _pinButton.Style = Topmost ? (Style)FindResource("ClayPrimaryButton") : SoftClayTheme.ButtonStyle();
        _pinButton.ToolTip = Topmost ? "取消置顶（P）" : "置顶到其他窗口上方（P）";
        AutomationProperties.SetName(_pinButton, Topmost ? "取消置顶" : "开启置顶");
    }

    // 先把 HWND 放入目标显示器再测量 DPI，避免负坐标或混合缩放桌面套用主屏比例。
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        SetWindowPos(new WindowInteropHelper(this).Handle, 0, _initialArea.Left + 24, _initialArea.Top + 24, 0, 0, 0x15);
    }
    // 跨屏移动后等待 WPF 完成 DPI 切换，再保持同一物理像素缩放比例。
    protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi)
    {
        base.OnDpiChanged(oldDpi, newDpi);
        if (_placed && !_closed) Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() => SetZoom(_zoom)));
    }
    protected override void OnClosed(EventArgs e) { _closed = true; _image.Source = null; base.OnClosed(e); }

    // HWND 边界使用物理像素；移动和缩放都不改变窗口层级或抢占其他窗口焦点。
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowPos(nint window, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(nint window, out NativeRect rect);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
}
