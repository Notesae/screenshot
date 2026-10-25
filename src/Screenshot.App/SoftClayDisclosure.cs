using System;
using System.Windows;
using System.Windows.Controls;

namespace Screenshot.App;

/// <summary>只裁切高度，不缩放字段；重定向从当前高度开始，关闭立即停止命中。</summary>
public sealed class SoftClayDisclosure : Decorator
{
    public static readonly DependencyProperty IsExpandedProperty = DependencyProperty.Register(
        nameof(IsExpanded), typeof(bool), typeof(SoftClayDisclosure), new PropertyMetadata(false, Changed));
    private static readonly DependencyProperty ProgressProperty = DependencyProperty.Register(
        "Progress", typeof(double), typeof(SoftClayDisclosure), new FrameworkPropertyMetadata(0d, FrameworkPropertyMetadataOptions.AffectsMeasure));
    private readonly DisclosureTransition _transition = new();
    private double _contentHeight;
    public bool IsExpanded { get => (bool)GetValue(IsExpandedProperty); set => SetValue(IsExpandedProperty, value); }
    internal double Progress => (double)GetValue(ProgressProperty);

    public SoftClayDisclosure()
    {
        ClipToBounds = true; Visibility = Visibility.Collapsed; IsEnabled = false;
        Unloaded += (_, _) => SoftClayMotion.StopTimeline(this);
    }
    private static void Changed(DependencyObject target, DependencyPropertyChangedEventArgs args)
    {
        var owner = (SoftClayDisclosure)target;
        owner.SetCurrentValue(IsEnabledProperty, owner.IsExpanded);
        owner.SetCurrentValue(IsHitTestVisibleProperty, owner.IsExpanded);
        owner.SetCurrentValue(VisibilityProperty, Visibility.Visible);
        owner._transition.Redirect(owner.IsExpanded ? 1 : 0);
        SoftClayMotion.Animate(owner, elapsed =>
        {
            owner._transition.Step(elapsed);
            owner.SetCurrentValue(ProgressProperty, owner._transition.Value);
            if (!owner._transition.Moving && !owner.IsExpanded) owner.SetCurrentValue(VisibilityProperty, Visibility.Collapsed);
            return owner._transition.Moving;
        });
    }
    protected override Size MeasureOverride(Size availableSize)
    {
        if (Child is null) return new Size();
        Child.Measure(new Size(availableSize.Width, double.PositiveInfinity));
        _contentHeight = Child.DesiredSize.Height;
        return new Size(Child.DesiredSize.Width, _contentHeight * Progress);
    }
    protected override Size ArrangeOverride(Size finalSize)
    {
        Child?.Arrange(new Rect(0, 0, finalSize.Width, _contentHeight));
        return finalSize;
    }
}

/// <summary>可反向的弹簧过渡；改目标保留当前位置与速度。纯状态可在没有窗口的情况下验证。</summary>
/// <param name="preset">共享弹簧预设：高度用近临界阻尼，箭头可用带回弹的预设。</param>
/// <param name="bounded">高度进度限制在 0..1，近临界阻尼的微小越界不会撑出空白或负高度。</param>
internal sealed class DisclosureTransition(string preset = "toolLayout", bool bounded = true)
{
    private readonly SoftClayMotion.SpringState _spring = new();
    public double Value => bounded ? Math.Clamp(_spring.Value, 0, 1) : _spring.Value;
    public double Target => _spring.To;
    public bool Moving => _spring.Moving;
    public void Redirect(double target) => _spring.To = target;
    public void Step(double elapsed)
    {
        if (double.IsPositiveInfinity(elapsed)) { _spring.Snap(_spring.To); return; }
        _spring.Step(elapsed, preset);
    }
}
