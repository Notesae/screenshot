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

/// <summary>约 190ms 的可反向高度过渡；纯状态可在没有窗口的情况下验证。</summary>
internal sealed class DisclosureTransition
{
    public double Value { get; private set; }
    public double Target { get; private set; }
    private double _from, _elapsed;
    public bool Moving => Value != Target;
    public void Redirect(double target) { _from = Value; Target = target; _elapsed = 0; }
    public void Step(double elapsed)
    {
        if (double.IsPositiveInfinity(elapsed)) { Value = Target; return; }
        _elapsed += Math.Clamp(elapsed, 0, .05);
        var p = Math.Clamp(_elapsed / SoftClayMotion.Duration("disclosure"), 0, 1);
        Value = p == 1 ? Target : _from + (Target - _from) * (1 - Math.Pow(1 - p, 3));
    }
}
