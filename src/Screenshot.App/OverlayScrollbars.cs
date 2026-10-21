using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace Screenshot.App;

// 共享 ScrollViewer 模板只覆盖滑块；活动计时不改变滚动命令、范围或内容宽度。
public static class OverlayScrollbars
{
    public static readonly DependencyProperty EnabledProperty = DependencyProperty.RegisterAttached(
        "Enabled", typeof(bool), typeof(OverlayScrollbars), new PropertyMetadata(false, EnabledChanged));
    private static readonly DependencyProperty StateProperty = DependencyProperty.RegisterAttached(
        "State", typeof(Activity), typeof(OverlayScrollbars));

    public static bool GetEnabled(DependencyObject target) => (bool)target.GetValue(EnabledProperty);
    public static void SetEnabled(DependencyObject target, bool value) => target.SetValue(EnabledProperty, value);

    private static void EnabledChanged(DependencyObject target, DependencyPropertyChangedEventArgs args)
    {
        if (target is not ScrollViewer viewer) return;
        if ((bool)args.NewValue)
        {
            viewer.Loaded += Start;
            viewer.Unloaded += Stop;
            if (viewer.IsLoaded) Start(viewer, new RoutedEventArgs());
        }
        else
        {
            viewer.Loaded -= Start;
            viewer.Unloaded -= Stop;
            Stop(viewer, new RoutedEventArgs());
        }
    }

    private static void Start(object sender, RoutedEventArgs args)
    {
        var viewer = (ScrollViewer)sender;
        if (viewer.GetValue(StateProperty) is null) viewer.SetValue(StateProperty, new Activity(viewer));
    }

    private static void Stop(object sender, RoutedEventArgs args)
    {
        var viewer = (ScrollViewer)sender;
        (viewer.GetValue(StateProperty) as Activity)?.Dispose();
        viewer.ClearValue(StateProperty);
    }

    private sealed class Activity : IDisposable
    {
        private readonly ScrollViewer _viewer;
        private readonly DispatcherTimer _idle;
        private readonly ScrollBar? _vertical, _horizontal;
        private bool _visible, _edgeHover;

        public Activity(ScrollViewer viewer)
        {
            _viewer = viewer;
            _vertical = viewer.Template?.FindName("PART_VerticalScrollBar", viewer) as ScrollBar;
            _horizontal = viewer.Template?.FindName("PART_HorizontalScrollBar", viewer) as ScrollBar;
            _idle = new DispatcherTimer(DispatcherPriority.Background, viewer.Dispatcher)
            {
                Interval = TimeSpan.FromMilliseconds(SoftClayTheme.Number("scroll", "hideDelay"))
            };
            _idle.Tick += HideWhenIdle;
            viewer.ScrollChanged += Scrolled;
            viewer.PreviewMouseMove += Moved;
            viewer.MouseEnter += Moved;
            viewer.MouseLeave += Left;
            viewer.PreviewMouseWheel += Wheel;
            viewer.PreviewKeyDown += KeyDown;
            viewer.LostMouseCapture += Released;
        }

        private void Scrolled(object sender, ScrollChangedEventArgs args)
        {
            if (ReferenceEquals(args.OriginalSource, _viewer) && (args.VerticalChange != 0 || args.HorizontalChange != 0)) Reveal();
        }

        private void Moved(object sender, MouseEventArgs args)
        {
            if (!Owns(args.OriginalSource)) return;
            var point = args.GetPosition(_viewer);
            var reach = SoftClayTheme.Number("scroll", "thickness") + 4;
            _edgeHover = _viewer.ScrollableHeight > 0 && point.X >= _viewer.ActualWidth - reach
                || _viewer.ScrollableWidth > 0 && point.Y >= _viewer.ActualHeight - reach;
            Reveal();
        }

        private void Left(object sender, MouseEventArgs args) { _edgeHover = false; ScheduleHide(); }
        private void Wheel(object sender, MouseWheelEventArgs args) { if (Owns(args.OriginalSource)) Reveal(); }
        private void Released(object sender, MouseEventArgs args) => ScheduleHide();
        private void KeyDown(object sender, KeyEventArgs args)
        {
            if (Owns(args.OriginalSource) && args.Key is Key.Up or Key.Down or Key.Left or Key.Right or Key.PageUp or Key.PageDown or Key.Home or Key.End or Key.Space) Reveal();
        }

        // 嵌套文本区只显示自己的滑块，不让父表单同时响应同一个滚动事件。
        private bool Owns(object source)
        {
            var current = source as DependencyObject;
            while (current is not null)
            {
                if (current is ScrollViewer scroll) return ReferenceEquals(scroll, _viewer);
                current = current is Visual ? VisualTreeHelper.GetParent(current) : LogicalTreeHelper.GetParent(current);
            }
            return false;
        }

        private void Reveal()
        {
            if (_viewer.ScrollableHeight <= 0 && _viewer.ScrollableWidth <= 0) return;
            if (!_visible) { _visible = true; Paint(_vertical, true); Paint(_horizontal, true); }
            ScheduleHide();
        }

        private void ScheduleHide() { _idle.Stop(); if (_visible) _idle.Start(); }
        private void HideWhenIdle(object? sender, EventArgs args)
        {
            _idle.Stop();
            if (_viewer.IsMouseCaptureWithin || _edgeHover && _viewer.IsMouseOver) { ScheduleHide(); return; }
            _visible = false;
            Paint(_vertical, false);
            Paint(_horizontal, false);
        }

        private static void Paint(ScrollBar? bar, bool visible)
        {
            if (bar is null) return;
            // 隐藏时立即让出命中区域，淡出残影不会挡住底下的输入和按钮。
            bar.IsHitTestVisible = visible;
            var duration = SystemParameters.ClientAreaAnimation ? SoftClayTheme.Number("scroll", "fade") : 0;
            bar.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(visible ? 1 : 0, TimeSpan.FromMilliseconds(duration)));
        }

        public void Dispose()
        {
            _idle.Stop();
            _idle.Tick -= HideWhenIdle;
            _viewer.ScrollChanged -= Scrolled;
            _viewer.PreviewMouseMove -= Moved;
            _viewer.MouseEnter -= Moved;
            _viewer.MouseLeave -= Left;
            _viewer.PreviewMouseWheel -= Wheel;
            _viewer.PreviewKeyDown -= KeyDown;
            _viewer.LostMouseCapture -= Released;
            foreach (var bar in new[] { _vertical, _horizontal })
            {
                if (bar is null) continue;
                bar.BeginAnimation(UIElement.OpacityProperty, null);
                bar.Opacity = 0;
                bar.IsHitTestVisible = false;
            }
        }
    }
}
