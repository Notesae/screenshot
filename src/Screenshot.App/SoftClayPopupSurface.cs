using System.Windows;
using System.Windows.Controls;

namespace Screenshot.App;

/// <summary>浮卡固定布局，只有独立材质缩放，正文保持可读的原尺寸。</summary>
public sealed class SoftClayPopupSurface : ContentControl
{
    public static readonly DependencyProperty CornerRadiusProperty = DependencyProperty.Register(
        nameof(CornerRadius), typeof(CornerRadius), typeof(SoftClayPopupSurface), new PropertyMetadata(new CornerRadius(12)));
    public CornerRadius CornerRadius { get => (CornerRadius)GetValue(CornerRadiusProperty); set => SetValue(CornerRadiusProperty, value); }

    public SoftClayPopupSurface()
    {
        Loaded += (_, _) =>
        {
            ApplyTemplate();
            if (GetTemplateChild("Face") is FrameworkElement face && GetTemplateChild("Glyph") is FrameworkElement glyph)
                SoftClayMotion.EnterSurface(this, face, glyph);
        };
        Unloaded += (_, _) => SoftClayMotion.StopSurface(this);
    }
}
