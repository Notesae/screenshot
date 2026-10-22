using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace Screenshot.App;

/// <summary>沿用 WPF 的 Popup 销毁窗口期和输入释放，只替换期内的材质运动。</summary>
internal sealed class SoftClayPopupMotion : IDisposable
{
    private readonly Popup _popup;
    private readonly SoftClayPopupSurface _surface;
    private readonly DependencyPropertyDescriptor _open;
    private bool _wasOpen, _disposed;

    private SoftClayPopupMotion(Popup popup, SoftClayPopupSurface surface)
    {
        _popup = popup; _surface = surface; _wasOpen = popup.IsOpen;
        _open = DependencyPropertyDescriptor.FromProperty(Popup.IsOpenProperty, typeof(Popup));
        _open.AddValueChanged(popup, Changed);
        popup.Opened += Opened; popup.Closed += Closed;
        SystemParameters.StaticPropertyChanged += MotionChanged;
        Configure(); ClearFrameworkFade(surface);
    }
    public static SoftClayPopupMotion? Attach(SoftClayPopupSurface surface)
    {
        // 模板宿主的逻辑父级仍是 Popup；不访问私有字段或创建替代窗口。
        DependencyObject? node = surface;
        for (var depth = 0; node is not null && depth < 32; depth++)
        {
            if (node is Popup popup) return new(popup, surface);
            if (node is Window) break;
            node = node is FrameworkElement element ? element.Parent ?? element.TemplatedParent
                : LogicalTreeHelper.GetParent(node);
        }
        return null;
    }
    private void Configure() => _popup.SetCurrentValue(Popup.PopupAnimationProperty,
        SystemParameters.ClientAreaAnimation ? PopupAnimation.Fade : PopupAnimation.None);
    private static void ClearFrameworkFade(Visual visual)
    {
        // 保留 WPF 150ms 销毁计时，但移除其从 1 开始的整层淡出，避免提前关闭跳亮。
        if (PresentationSource.FromVisual(visual)?.RootVisual is UIElement root && root is not Window)
            root.BeginAnimation(UIElement.OpacityProperty, null);
    }
    private void Opened(object? sender, EventArgs args)
    {
        if (_disposed) return;
        ClearFrameworkFade(_surface); Changed(sender, args);
    }
    private void Changed(object? sender, EventArgs args)
    {
        if (_disposed || _wasOpen == _popup.IsOpen) return;
        _wasOpen = _popup.IsOpen;
        ClearFrameworkFade(_surface);
        _surface.SetClosing(!_wasOpen);
        if (_wasOpen) { _surface.Enter(); return; }
        var (x, y) = Direction(_popup.Placement);
        SoftClayMotion.ExitSurface(_surface, NativeSurfaceTransition.PopupExitSeconds, x, y);
    }
    internal static (double X, double Y) Direction(PlacementMode placement) => placement switch
    {
        PlacementMode.Bottom or PlacementMode.Mouse or PlacementMode.MousePoint => (0, -1), PlacementMode.Top => (0, 1),
        PlacementMode.Left => (1, 0), PlacementMode.Right => (-1, 0), _ => (0, 1)
    };
    private void MotionChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (_disposed || args.PropertyName != nameof(SystemParameters.ClientAreaAnimation)) return;
        Configure(); ClearFrameworkFade(_surface);
        if (!SystemParameters.ClientAreaAnimation) SoftClayMotion.StopTimeline(_surface);
    }
    private void Closed(object? sender, EventArgs args)
    {
        if (!_disposed && !_popup.IsOpen) SoftClayMotion.StopSurface(_surface);
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _open.RemoveValueChanged(_popup, Changed);
        _popup.Opened -= Opened; _popup.Closed -= Closed;
        SystemParameters.StaticPropertyChanged -= MotionChanged;
    }
}
