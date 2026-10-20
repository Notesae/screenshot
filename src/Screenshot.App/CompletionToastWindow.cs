using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;

namespace Screenshot.App;

// 独立提示不持有截图像素；主编辑层隐藏后仍能通过明确按钮继续同一份文档。
internal sealed class CompletionToastWindow : Window
{
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(10) };
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    public CompletionToastWindow(string message, Action resume, PixelRect area)
    {
        Width = 430; Height = 112; WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
        ShowActivated = false; ShowInTaskbar = false; Topmost = true; AllowsTransparency = true; Background = Brushes.Transparent;
        WindowStartupLocation = WindowStartupLocation.Manual;
        // 工作区用物理像素定位；进入目标屏幕后再按该窗口 DPI 校正尺寸，不套用主屏坐标。
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
        var panel = new DockPanel { LastChildFill = true, Margin = new Thickness(18, 14, 18, 14) };
        var button = new Button { Content = "继续编辑", Margin = new Thickness(12, 0, 0, 0), FontSize = 13,
            Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center, MinHeight = 40 };
        // 固定原生模板避免系统主题把蓝色动作按钮改成默认灰边框。
        var face = new FrameworkElementFactory(typeof(Border));
        face.SetValue(Border.CornerRadiusProperty, new CornerRadius(14));
        face.SetValue(Border.PaddingProperty, new Thickness(14, 10, 14, 10));
        face.SetValue(Border.BackgroundProperty, new LinearGradientBrush(Color.FromRgb(59, 130, 246), Color.FromRgb(29, 78, 216), 90));
        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center); face.AppendChild(content);
        button.Template = new ControlTemplate(typeof(Button)) { VisualTree = face };
        button.RenderTransformOrigin = new Point(.5, .5); button.RenderTransform = new ScaleTransform(1, 1);
        button.IsEnabledChanged += (_, _) => button.Opacity = button.IsEnabled ? 1 : .4;
        button.Click += (_, _) => { Close(); resume(); };
        DockPanel.SetDock(button, Dock.Right); panel.Children.Add(button);
        panel.Children.Add(new TextBlock { Text = message + "\n可编辑内容已保留", Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center, FontSize = 13 });
        Content = new Border { Margin = new Thickness(14), Background = new LinearGradientBrush(Color.FromRgb(74, 70, 66), Color.FromRgb(42, 39, 36), 90),
            BorderBrush = new SolidColorBrush(Color.FromArgb(50, 255, 255, 255)), BorderThickness = new Thickness(0, 1, 0, 0),
            Effect = new DropShadowEffect { BlurRadius = 20, ShadowDepth = 8, Opacity = .55 }, CornerRadius = new CornerRadius(24), Child = panel };
        _timer.Tick += (_, _) => Close(); Closed += (_, _) => _timer.Stop();
        MouseEnter += (_, _) => _timer.Stop(); MouseLeave += (_, _) => _timer.Start();
        Loaded += (_, _) =>
        {
            Place();
            if (SystemParameters.ClientAreaAnimation)
            {
                BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)));
                var move = new TranslateTransform(0, 10); ((Border)Content).RenderTransform = move;
                move.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(10, 0, TimeSpan.FromMilliseconds(280)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            }
            _timer.Start();
        };
    }
}
