using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace Screenshot.App;

// 独立提示只包含结果与继续动作；键盘焦点暂停自动消失，不持有截图或凭据。
internal sealed class CompletionToastWindow : Window
{
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(SoftClayTheme.Number("motion", "toastHold")) };
    private bool _closing;
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

    // 用户显式输出完成后使提示可获焦点，Enter/空格和 Ctrl+Enter 均可继续编辑。
    public CompletionToastWindow(string message, Action resume, PixelRect area)
    {
        Width = 400; Height = 110; WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        ShowActivated = true; ShowInTaskbar = false; Topmost = true; AllowsTransparency = true; Background = Brushes.Transparent;
        WindowStartupLocation = WindowStartupLocation.Manual; UseLayoutRounding = true; SnapsToDevicePixels = true;
        FontFamily = new FontFamily("Segoe UI Variable, Segoe UI, Microsoft YaHei UI");
        // 目标工作区为物理像素；窗口跨入目标屏幕后用其实际 DPI 重新放置。
        void Place()
        {
            var handle = new WindowInteropHelper(this).Handle;
            var scale = Math.Max(96, GetDpiForWindow(handle)) / 96d;
            var width = Math.Min(area.Width, (int)Math.Round(Width * scale));
            var height = Math.Min(area.Height, (int)Math.Round(Height * scale));
            var margin = (int)Math.Round(12 * scale);
            SetWindowPos(handle, IntPtr.Zero, Math.Max(area.X, area.X + area.Width - width - margin), Math.Max(area.Y, area.Y + area.Height - height - margin), width, height, 0x0010 | 0x0004);
        }
        SourceInitialized += (_, _) => Place();
        var panel = new DockPanel { LastChildFill = true, Margin = new Thickness(14) };
        var button = new Button { Content = "继续编辑", Background = SoftClayTheme.Surface(true), Style = SoftClayTheme.ButtonStyle(), Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, IsDefault = true, Focusable = true };
        System.Windows.Automation.AutomationProperties.SetHelpText(button, "按 Enter、空格或 Ctrl+Enter 继续编辑，聚焦时提示保持显示。");
        button.Click += (_, _) => { if (_closing) return; button.IsEnabled = false; Close(); resume(); };
        DockPanel.SetDock(button, Dock.Right); panel.Children.Add(button);
        var labels = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        labels.Children.Add(new TextBlock { Text = message, Foreground = SoftClayTheme.Brush("ink"), FontSize = 14, FontWeight = FontWeights.SemiBold });
        labels.Children.Add(new TextBlock { Text = "Enter 继续 · 离开焦点后自动收起", Foreground = SoftClayTheme.Brush("muted"), FontSize = 11, Margin = new Thickness(0, 3, 0, 0) });
        panel.Children.Add(labels);
        Content = new Border { Margin = new Thickness(14), Background = SoftClayTheme.Surface(), Effect = SoftClayTheme.Shadow(), CornerRadius = new CornerRadius(SoftClayTheme.Number("radius", "toast")), Child = panel };
        _timer.Tick += (_, _) => Close(); Closed += (_, _) => _timer.Stop();
        MouseEnter += (_, _) => _timer.Stop();
        MouseLeave += (_, _) => { if (!IsKeyboardFocusWithin) _timer.Start(); };
        GotKeyboardFocus += (_, _) => _timer.Stop();
        LostKeyboardFocus += (_, _) => { if (!IsKeyboardFocusWithin && !IsMouseOver) _timer.Start(); };
        PreviewKeyDown += (_, e) => { if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control) { e.Handled = true; button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); } else if (e.Key == Key.Escape) { e.Handled = true; Close(); } };
        Loaded += (_, _) =>
        {
            Place(); button.Focus();
            if (SystemParameters.ClientAreaAnimation)
            {
                var duration = TimeSpan.FromMilliseconds(SoftClayTheme.Number("motion", "toast"));
                BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, duration));
                var move = new TranslateTransform(0, 16); ((Border)Content).RenderTransform = move;
                move.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(16, 0, duration) { EasingFunction = SoftClayTheme.Spring() });
            }
            if (!IsKeyboardFocusWithin) _timer.Start();
        };
    }

    // 自动收起和显式关闭共用退出动画；系统减少动态效果时直接关闭。
    protected override void OnClosing(CancelEventArgs e)
    {
        if (!_closing && SystemParameters.ClientAreaAnimation)
        {
            e.Cancel = true; _closing = true; _timer.Stop(); IsHitTestVisible = false;
            var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(SoftClayTheme.Number("motion", "exit")));
            fade.Completed += (_, _) => Close(); BeginAnimation(OpacityProperty, fade);
        }
        base.OnClosing(e);
    }
}
