using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Screenshot.App;

// 对应网页的曲面、凸面和凹面；材质只绘制渐变，不绘制轮廓线。
public enum SoftClayMaterial { Flat, Floating, Raised, Primary, Inset, Pressed }

public sealed class SoftClaySurface : Border
{
    // NaN 保持普通原生表面；轨道曲率只重绘局部矢量，不逐帧改 Border 圆角触发布局。
    public static readonly DependencyProperty RailBendProperty = DependencyProperty.Register(
        nameof(RailBend), typeof(double), typeof(SoftClaySurface),
        new FrameworkPropertyMetadata(double.NaN, FrameworkPropertyMetadataOptions.AffectsRender));
    public double RailBend { get => (double)GetValue(RailBendProperty); set => SetValue(RailBendProperty, value); }
    private static readonly double[] CornerPull = SoftClayMotion.RailButtonTokens.GetProperty("cornerPull").EnumerateArray().Select(value => value.GetDouble()).ToArray();
    // 附加属性让按钮样式选择材质，模板内的表面只负责绘制。
    public static readonly DependencyProperty MaterialProperty = DependencyProperty.RegisterAttached(
        "Material", typeof(SoftClayMaterial), typeof(SoftClaySurface),
        new FrameworkPropertyMetadata(SoftClayMaterial.Flat, FrameworkPropertyMetadataOptions.AffectsRender));

    public SoftClayMaterial Material { get => GetMaterial(this); set => SetMaterial(this, value); }
    public static SoftClayMaterial GetMaterial(DependencyObject target) => (SoftClayMaterial)target.GetValue(MaterialProperty);
    public static void SetMaterial(DependencyObject target, SoftClayMaterial value) => target.SetValue(MaterialProperty, value);

    private static readonly Brush SurfaceLight = Fade(SoftClayTheme.Color("highlight", "shadow"));
    private static readonly Brush SurfaceShade = Fade(SoftClayTheme.Color("shade", "shadow"), true);
    private static readonly Brush ButtonLight = Fade(SoftClayTheme.Color("raisedHighlight"));
    private static readonly Brush ButtonShade = Fade(SoftClayTheme.Color("raisedShade"), true);
    private static readonly Brush PrimaryLight = Fade(SoftClayTheme.Color("primaryHighlight"));
    private static readonly Brush PrimaryShade = Fade(SoftClayTheme.Color("primaryShade"), true);
    private static readonly Brush WellShade = Fade(SoftClayTheme.Color("insetShade"));

    // 内高光和暗部限制在固定的边缘深度，长表单也不会变成一整块黑色渐变。
    protected override void OnRender(DrawingContext drawing)
    {
        if (RenderSize.Width <= 0 || RenderSize.Height <= 0) return;
        var box = new Rect(RenderSize);
        var radius = Math.Min(CornerRadius.TopLeft, Math.Min(box.Width, box.Height) / 2);
        var shape = double.IsNaN(RailBend) ? (Geometry)new RectangleGeometry(box, radius, radius) : RailOutline(box, radius, RailBend);
        if (double.IsNaN(RailBend)) base.OnRender(drawing);
        else if (Background is not null) drawing.DrawGeometry(Background, null, shape);
        if (Material == SoftClayMaterial.Flat) return;
        drawing.PushClip(shape);
        switch (Material)
        {
            case SoftClayMaterial.Floating:
                Edge(drawing, box, SurfaceLight, 5);
                Edge(drawing, box, SurfaceShade, 10, true);
                break;
            case SoftClayMaterial.Raised:
                Edge(drawing, box, ButtonLight, 3);
                Edge(drawing, box, ButtonShade, 4, true);
                break;
            case SoftClayMaterial.Primary:
                Edge(drawing, box, PrimaryLight, 3);
                Edge(drawing, box, PrimaryShade, 4, true);
                break;
            case SoftClayMaterial.Inset:
                Edge(drawing, box, WellShade, 8);
                break;
            case SoftClayMaterial.Pressed:
                Edge(drawing, box, WellShade, 5);
                break;
        }
        drawing.Pop();
    }

    // 与轨道四角使用相同拉扯系数；成对限幅保证小按钮的圆弧不会交叉。
    private static Geometry RailOutline(Rect box, double radius, double bend)
    {
        var corners = CornerPull.Select(pull => Math.Max(0, radius + bend * pull)).ToArray();
        var factor = Math.Min(1, Math.Min(Math.Min(box.Width / Math.Max(.001, corners[0] + corners[1]), box.Width / Math.Max(.001, corners[3] + corners[2])),
            Math.Min(box.Height / Math.Max(.001, corners[0] + corners[3]), box.Height / Math.Max(.001, corners[1] + corners[2]))));
        for (var index = 0; index < corners.Length; index++) corners[index] *= factor;
        var shape = new StreamGeometry();
        using (var path = shape.Open())
        {
            path.BeginFigure(new Point(corners[0], 0), true, true);
            path.LineTo(new Point(box.Width - corners[1], 0), true, false);
            path.ArcTo(new Point(box.Width, corners[1]), new Size(corners[1], corners[1]), 0, false, SweepDirection.Clockwise, true, false);
            path.LineTo(new Point(box.Width, box.Height - corners[2]), true, false);
            path.ArcTo(new Point(box.Width - corners[2], box.Height), new Size(corners[2], corners[2]), 0, false, SweepDirection.Clockwise, true, false);
            path.LineTo(new Point(corners[3], box.Height), true, false);
            path.ArcTo(new Point(0, box.Height - corners[3]), new Size(corners[3], corners[3]), 0, false, SweepDirection.Clockwise, true, false);
            path.LineTo(new Point(0, corners[0]), true, false);
            path.ArcTo(new Point(corners[0], 0), new Size(corners[0], corners[0]), 0, false, SweepDirection.Clockwise, true, false);
        }
        shape.Freeze(); return shape;
    }

    private static void Edge(DrawingContext drawing, Rect box, Brush brush, double depth, bool bottom = false)
    {
        depth = Math.Min(depth, box.Height / 2);
        drawing.DrawRectangle(brush, null, new Rect(0, bottom ? box.Height - depth : 0, box.Width, depth));
    }

    private static Brush Fade(Color color, bool bottom = false)
    {
        // 多段透明度模拟柔和内阴影，不用 1px 高光线冒充材质。
        var brush = new LinearGradientBrush
        {
            StartPoint = new Point(0, bottom ? 1 : 0), EndPoint = new Point(0, bottom ? 0 : 1),
            GradientStops = new GradientStopCollection
            {
                new(color, 0), new(Color.FromArgb((byte)(color.A * .45), color.R, color.G, color.B), .35),
                new(Color.FromArgb((byte)(color.A * .1), color.R, color.G, color.B), .7),
                new(Color.FromArgb(0, color.R, color.G, color.B), 1)
            }
        };
        brush.Freeze();
        return brush;
    }
}
