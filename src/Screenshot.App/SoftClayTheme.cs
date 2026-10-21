using System;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Input;
using System.Windows.Media.Animation;

namespace Screenshot.App;

// 原生层直接读取与 React 相同的嵌入式 token，避免打包时遗漏或运行时读取外部配置。
internal static class SoftClayTheme
{
    private static readonly JsonDocument Tokens = JsonDocument.Parse(typeof(SoftClayTheme).Assembly.GetManifestResourceStream("Screenshot.SoftClayTokens")
        ?? throw new IOException("缺少共享设计 token。"));
    public static double Number(string group, string name) => Tokens.RootElement.GetProperty(group).GetProperty(name).GetDouble();
    public static string Text(string group, string name) => Tokens.RootElement.GetProperty(group).GetProperty(name).GetString()!;
    public static Color Color(string name)
    {
        var hex=Text("colors",name);
        return (Color)ColorConverter.ConvertFromString(hex.Length==9?"#"+hex.Substring(7,2)+hex.Substring(1,6):hex);
    }
    public static SolidColorBrush Brush(string name) => new(Color(name));
    public static LinearGradientBrush Surface(bool primary = false) => new(Color(primary ? "accentTop" : "surfaceTop"), Color(primary ? "accentBottom" : "surfaceBottom"), 90);
    public static DropShadowEffect Shadow() => new() { BlurRadius = Number("shadow", "blur"), ShadowDepth = Number("shadow", "depth"), Opacity = Number("shadow", "opacity") };
    public static IEasingFunction Spring() => new SharedSpringEase { EasingMode = EasingMode.EaseIn };

    // 控件资源只含视觉值；不创建窗口，不注册热键，不改变条款或服务的启动顺序。
    public static void Install(ResourceDictionary resources)
    {
        foreach(var color in Tokens.RootElement.GetProperty("colors").EnumerateObject())
            resources["Clay"+char.ToUpperInvariant(color.Name[0])+color.Name.Substring(1)]=Brush(color.Name);
        resources["ClayControlRadius"]=new CornerRadius(Number("radius","control"));
        resources["ClaySurface"]=Surface();
        var button=ButtonStyle();resources["ClayButton"]=button;resources[typeof(Button)]=button;
        resources.MergedDictionaries.Add(new ResourceDictionary { Source=new Uri("/"+typeof(SoftClayTheme).Assembly.GetName().Name+";component/SoftClayControls.xaml",UriKind.Relative) });
    }

    // 完整替换按钮模板并定义悬停、按压、焦点及禁用态，杜绝默认 Windows 控件外观。
    public static Style ButtonStyle()
    {
        var style = new Style(typeof(Button));
        style.Setters.Add(new Setter(Control.ForegroundProperty, Brush("ink")));
        style.Setters.Add(new Setter(Control.BackgroundProperty, Surface()));
        style.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(14, 8, 14, 8)));
        style.Setters.Add(new Setter(FrameworkElement.MinHeightProperty, Number("size", "control")));
        style.Setters.Add(new Setter(Control.FontFamilyProperty, new FontFamily(Tokens.RootElement.GetProperty("font").GetString()!)));
        style.Setters.Add(new Setter(Control.FontSizeProperty, 13d));
        var face = new FrameworkElementFactory(typeof(Border), "Face");
        face.SetValue(Border.CornerRadiusProperty, new CornerRadius(Number("radius", "control")));
        face.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
        face.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));
        face.SetValue(Border.BorderThicknessProperty, new Thickness(1));
        face.SetValue(Border.BorderBrushProperty, new LinearGradientBrush(System.Windows.Media.Color.FromArgb(65, 255, 255, 255), System.Windows.Media.Color.FromArgb(100, 0, 0, 0), 90));
        face.SetValue(UIElement.EffectProperty, Shadow());
        face.SetValue(UIElement.RenderTransformOriginProperty, new Point(.5, .5));
        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(ContentPresenter.RecognizesAccessKeyProperty, true);
        content.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        content.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        face.AppendChild(content);
        var template = new ControlTemplate(typeof(Button)) { VisualTree = face };
        var hover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        hover.Setters.Add(new Setter(Border.BorderBrushProperty, Brush("focus"), "Face"));
        template.Triggers.Add(hover);
        var focus = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
        focus.Setters.Add(new Setter(Border.BorderBrushProperty, Brush("focus"), "Face"));
        focus.Setters.Add(new Setter(Border.BorderThicknessProperty, new Thickness(2), "Face"));
        template.Triggers.Add(focus);
        var press = new Trigger { Property = Button.IsPressedProperty, Value = true };
        press.Setters.Add(new Setter(UIElement.EffectProperty, null, "Face"));
        template.Triggers.Add(press);
        var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabled.Setters.Add(new Setter(UIElement.OpacityProperty, .4, "Face"));
        disabled.Setters.Add(new Setter(UIElement.EffectProperty, null, "Face"));
        template.Triggers.Add(disabled);
        style.Setters.Add(new Setter(Control.TemplateProperty, template));
        style.Setters.Add(new EventSetter(UIElement.PreviewMouseLeftButtonDownEvent, new MouseButtonEventHandler((sender, _) => AnimatePress((Button)sender, true))));
        style.Setters.Add(new EventSetter(UIElement.PreviewMouseLeftButtonUpEvent, new MouseButtonEventHandler((sender, _) => AnimatePress((Button)sender, false))));
        style.Setters.Add(new EventSetter(UIElement.LostMouseCaptureEvent, new MouseEventHandler((sender, _) => AnimatePress((Button)sender, false))));
        style.Setters.Add(new EventSetter(UIElement.PreviewKeyDownEvent, new KeyEventHandler((sender, e) => { if(e.Key is Key.Space or Key.Enter)AnimatePress((Button)sender,true); })));
        style.Setters.Add(new EventSetter(UIElement.PreviewKeyUpEvent, new KeyEventHandler((sender, e) => { if(e.Key is Key.Space or Key.Enter)AnimatePress((Button)sender,false); })));
        return style;
    }

    // 指针与键盘按压共用 token；系统关闭动态效果时只改变最终状态。
    private static void AnimatePress(Button button, bool pressed)
    {
        if(button.RenderTransform is not ScaleTransform scale){scale=new ScaleTransform(1,1);button.RenderTransform=scale;button.RenderTransformOrigin=new Point(.5,.5);}
        var target=pressed?Number("motion","pressedScale"):1;
        if(!SystemParameters.ClientAreaAnimation){scale.BeginAnimation(ScaleTransform.ScaleXProperty,null);scale.BeginAnimation(ScaleTransform.ScaleYProperty,null);scale.ScaleX=scale.ScaleY=target;return;}
        var animation=new DoubleAnimation(target,TimeSpan.FromMilliseconds(Number("motion",pressed?"press":"release"))){EasingFunction=Spring()};
        scale.BeginAnimation(ScaleTransform.ScaleXProperty,animation);scale.BeginAnimation(ScaleTransform.ScaleYProperty,animation);
    }

    // 反解 CSS cubic-bezier 的时间轴，使原生回弹与网页使用同一组控制点。
    private sealed class SharedSpringEase : EasingFunctionBase
    {
        private readonly double _x1=Tokens.RootElement.GetProperty("motion").GetProperty("spring")[0].GetDouble();
        private readonly double _y1=Tokens.RootElement.GetProperty("motion").GetProperty("spring")[1].GetDouble();
        private readonly double _x2=Tokens.RootElement.GetProperty("motion").GetProperty("spring")[2].GetDouble();
        private readonly double _y2=Tokens.RootElement.GetProperty("motion").GetProperty("spring")[3].GetDouble();
        protected override Freezable CreateInstanceCore() => new SharedSpringEase();
        protected override double EaseInCore(double time)
        {
            double low=0,high=1,t=time;
            for(var i=0;i<18;i++){var inverse=1-t;var x=3*inverse*inverse*t*_x1+3*inverse*t*t*_x2+t*t*t;if(x<time)low=t;else high=t;t=(low+high)/2;}
            var rest=1-t;return 3*rest*rest*t*_y1+3*rest*t*t*_y2+t*t*t;
        }
    }
}

// WinForms 框选层和托盘菜单也从共享 token 绘制，不依赖系统菜单渲染器。
internal static class SoftClayDrawing
{
    // CSS 八位颜色采用 RRGGBBAA，转换时不能按 WPF 的 AARRGGBB 顺序解释。
    public static System.Drawing.Color Color(string name)
    {
        var hex = SoftClayTheme.Text("colors", name);
        return hex.Length == 9 ? System.Drawing.Color.FromArgb(Convert.ToByte(hex.Substring(7, 2), 16), System.Drawing.ColorTranslator.FromHtml(hex.Substring(0, 7))) : System.Drawing.ColorTranslator.FromHtml(hex);
    }
    public static System.Drawing.Drawing2D.GraphicsPath Rounded(System.Drawing.RectangleF box, float radius)
    {
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        var diameter = Math.Min(radius * 2, Math.Min(box.Width, box.Height));
        path.AddArc(box.X, box.Y, diameter, diameter, 180, 90); path.AddArc(box.Right-diameter, box.Y, diameter, diameter, 270, 90);
        path.AddArc(box.Right-diameter, box.Bottom-diameter, diameter, diameter, 0, 90); path.AddArc(box.X, box.Bottom-diameter, diameter, diameter, 90, 90);
        path.CloseFigure(); return path;
    }
    // 顶部高光和底部暗边形成凸面，所有几何尺寸由调用方按目标 DPI 计算。
    public static void Surface(System.Drawing.Graphics graphics, System.Drawing.RectangleF box, float radius, bool active = false)
    {
        using var path = Rounded(box, radius);
        using var face = new System.Drawing.Drawing2D.LinearGradientBrush(box, Color(active?"accentTop":"surfaceTop"), Color(active?"accentBottom":"surfaceBottom"), 90);
        graphics.FillPath(face, path);
        using var rim = new System.Drawing.Drawing2D.LinearGradientBrush(box, System.Drawing.Color.FromArgb(70,255,255,255), System.Drawing.Color.FromArgb(80,0,0,0), 90);
        using var pen = new System.Drawing.Pen(rim, 1); graphics.DrawPath(pen, path);
    }
}

// 托盘菜单保留 Windows 的键盘和无障碍行为，仅替换表面与状态绘制。
internal sealed class SoftClayMenuRenderer : System.Windows.Forms.ToolStripProfessionalRenderer
{
    protected override void OnRenderToolStripBackground(System.Windows.Forms.ToolStripRenderEventArgs e)
    {
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        SoftClayDrawing.Surface(e.Graphics, new System.Drawing.RectangleF(0,0,e.ToolStrip.Width-1,e.ToolStrip.Height-1), (float)SoftClayTheme.Number("radius","floating"));
    }
    protected override void OnRenderToolStripBorder(System.Windows.Forms.ToolStripRenderEventArgs e) { }
    protected override void OnRenderImageMargin(System.Windows.Forms.ToolStripRenderEventArgs e) { }
    protected override void OnRenderItemText(System.Windows.Forms.ToolStripItemTextRenderEventArgs e) { e.TextColor=SoftClayDrawing.Color(e.Item.Enabled?"ink":"muted");base.OnRenderItemText(e); }
    protected override void OnRenderMenuItemBackground(System.Windows.Forms.ToolStripItemRenderEventArgs e)
    {
        if(e.Item.Selected||e.Item.Pressed)SoftClayDrawing.Surface(e.Graphics,new System.Drawing.RectangleF(4,2,e.Item.Width-8,e.Item.Height-4),(float)SoftClayTheme.Number("radius","control"),true);
    }
    protected override void OnRenderSeparator(System.Windows.Forms.ToolStripSeparatorRenderEventArgs e)
    {
        using var pen=new System.Drawing.Pen(SoftClayDrawing.Color("muted"));e.Graphics.DrawLine(pen,12,e.Item.Height/2,e.Item.Width-12,e.Item.Height/2);
    }
}
