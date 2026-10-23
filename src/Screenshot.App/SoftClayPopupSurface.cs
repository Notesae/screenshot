using System.Windows;
using System.Windows.Controls;

namespace Screenshot.App;

/// <summary>浮卡固定布局，只有独立材质缩放，正文保持可读的原尺寸。</summary>
public sealed class SoftClayPopupSurface : ContentControl
{
    private static readonly DependencyPropertyKey IsClosingPropertyKey = DependencyProperty.RegisterReadOnly(
        nameof(IsClosing), typeof(bool), typeof(SoftClayPopupSurface), new PropertyMetadata(false));
    public static readonly DependencyProperty IsClosingProperty = IsClosingPropertyKey.DependencyProperty;
    public static readonly DependencyProperty CornerRadiusProperty = DependencyProperty.Register(
        nameof(CornerRadius), typeof(CornerRadius), typeof(SoftClayPopupSurface), new PropertyMetadata(new CornerRadius(12)));
    public CornerRadius CornerRadius { get => (CornerRadius)GetValue(CornerRadiusProperty); set => SetValue(CornerRadiusProperty, value); }
    public bool IsClosing => (bool)GetValue(IsClosingProperty);
    private SoftClayPopupMotion? _popup;
    protected override bool IsEnabledCore => !IsClosing && base.IsEnabledCore;

    public SoftClayPopupSurface()
    {
        Loaded += (_, _) =>
        {
            SetClosing(false); Enter();
            _popup?.Dispose(); _popup = SoftClayPopupMotion.Attach(this);
        };
        Unloaded += (_, _) => { _popup?.Dispose(); _popup = null; SoftClayMotion.StopSurface(this); };
    }
    internal void SetClosing(bool closing)
    {
        SetValue(IsClosingPropertyKey, closing);
        CoerceValue(IsEnabledProperty);
    }
    internal void Enter()
    {
        ApplyTemplate();
        if (GetTemplateChild("Face") is FrameworkElement face && GetTemplateChild("Glyph") is FrameworkElement glyph)
            SoftClayMotion.EnterSurface(this, face, glyph);
    }
}
