using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace Screenshot.App;

internal static class NativeNoticePolicy
{
    public static TimeSpan? Timeout(bool error) => error ? null : TimeSpan.FromSeconds(4);
    // 分层正文整窗穿透；关闭按钮由独立、不会捕获外部点击的 Popup 承接。
    public static nint BodyStyle(nint current) => current | 0x20 | 0x08000000; // TRANSPARENT / NOACTIVATE
}

/// <summary>驻留托盘的通知不激活编辑器；正文穿透，只有关闭槽位接收输入。</summary>
internal sealed class SoftClayNoticeWindow : SoftClayWindow
{
    private readonly Popup _closePopup;
    private readonly DispatcherTimer? _timer;
    private readonly TaskCompletionSource _closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal Task ClosedTask => _closed.Task;

    public SoftClayNoticeWindow(string text, bool error)
    {
        var area = SystemParameters.WorkArea;
        FontFamily = SoftClayTheme.Font; FontSize = SoftClayTheme.Number("type", "body");
        Width = Math.Min(440, area.Width - 32); SizeToContent = SizeToContent.Height;
        WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        ShowActivated = false; ShowInTaskbar = false; Topmost = true;
        AllowsTransparency = true; Background = Brushes.Transparent; Focusable = false;
        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition());
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.Children.Add(new TextBlock
        {
            Text = text, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center,
            Foreground = SoftClayTheme.Brush("ink"), Margin = new Thickness(0, 0, 12, 0)
        });
        var closeSlot = new Border { Width = 32, Height = 32, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(closeSlot, 1); content.Children.Add(closeSlot);
        Content = new SoftClayPopupSurface
        {
            Style = (Style)FindResource(typeof(SoftClayPopupSurface)), Margin = new Thickness(16),
            Padding = new Thickness(16, 12, 16, 12), Content = content,
            Background = error ? SoftClayTheme.Brush("errorSurface") : SoftClayTheme.CardSurface()
        };
        var close = new Button { Style = (Style)FindResource("ClayCloseButton"), Focusable = false, ToolTip = null };
        AutomationProperties.SetName(close, "关闭提示"); close.Click += (_, _) => Close();
        _closePopup = new Popup
        {
            PlacementTarget = closeSlot, Placement = PlacementMode.Relative, StaysOpen = true,
            AllowsTransparency = true, Focusable = false,
            Child = new SoftClayPopupSurface { Style = (Style)FindResource("ClayNoticeClose"), Content = close }
        };
        if (NativeNoticePolicy.Timeout(error) is { } timeout)
        {
            _timer = new DispatcherTimer { Interval = timeout };
            _timer.Tick += (_, _) => Close();
        }
        Loaded += (_, _) =>
        {
            Left = area.Right - ActualWidth - 16; Top = area.Bottom - ActualHeight - 16;
            _closePopup.IsOpen = true; _timer?.Start();
        };
    }
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        SetWindowLongPtr(handle, -20, NativeNoticePolicy.BodyStyle(GetWindowLongPtr(handle, -20)));
    }
    protected override void OnClosing(CancelEventArgs e)
    {
        _timer?.Stop(); _closePopup.IsOpen = false;
        base.OnClosing(e);
    }
    protected override void OnClosed(EventArgs e)
    {
        _timer?.Stop(); _closePopup.IsOpen = false;
        base.OnClosed(e); _closed.TrySetResult();
    }
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern nint GetWindowLongPtr(nint window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern nint SetWindowLongPtr(nint window, int index, nint value);
}
