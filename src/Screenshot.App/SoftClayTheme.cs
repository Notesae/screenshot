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
    public static Color Color(string name, string group = "colors")
    {
        var hex=Text(group,name);
        return (Color)ColorConverter.ConvertFromString(hex.Length==9?"#"+hex.Substring(7,2)+hex.Substring(1,6):hex);
    }
    public static SolidColorBrush Brush(string name) => new(Color(name));
    // 以原截图导轨的材质为基准，WPF 与网页使用相同色阶与停靠位置。
    public static LinearGradientBrush Surface(bool primary = false) => new()
    {
        StartPoint = new Point(0, 0), EndPoint = new Point(0, 1),
        GradientStops = primary
            ? new GradientStopCollection { new(Color("accentTop"), 0), new(Color("accentBottom"), .35), new(Color("accentLow"), 1) }
            : new GradientStopCollection { new(Color("surfaceTop"), 0), new(Color("surfaceMid"), .35), new(Color("surfaceLow"), .7), new(Color("surfaceBase"), 1) }
    };
    public static LinearGradientBrush Raised() => new()
    {
        StartPoint = new Point(0, 0), EndPoint = new Point(0, 1),
        GradientStops = new GradientStopCollection { new(Color("raisedTop"), 0), new(Color("raisedMid"), .5), new(Color("raisedBottom"), 1) }
    };
    // 大浮卡沿用原属性卡的暖灰渐变，导轨的深色四段曲面只用于短小表面。
    public static LinearGradientBrush CardSurface() => new(Color("surfaceTop"), Color("surfaceBottom"), 90);
    public static DropShadowEffect Shadow() => new() { BlurRadius = Number("shadow", "blur"), ShadowDepth = Number("shadow", "depth"), Opacity = Number("shadow", "opacity") };
    public static IEasingFunction Spring() => new SharedSpringEase { EasingMode = EasingMode.EaseIn };

    // 控件资源只含视觉值；不创建窗口，不注册热键，不改变条款或服务的启动顺序。
    public static FontFamily Font => new(Tokens.RootElement.GetProperty("font").GetString()!);
    private static bool _buttonFeedbackInstalled;

    public static void Install(ResourceDictionary resources)
    {
        foreach (var color in Tokens.RootElement.GetProperty("colors").EnumerateObject())
            resources["Clay" + char.ToUpperInvariant(color.Name[0]) + color.Name.Substring(1)] = Brush(color.Name);
        foreach (var size in Tokens.RootElement.GetProperty("type").EnumerateObject())
            resources["Clay" + char.ToUpperInvariant(size.Name[0]) + size.Name.Substring(1) + "Size"] = size.Value.GetDouble();
        resources["ClayFont"] = Font;
        resources["ClayControlRadius"] = new CornerRadius(Number("radius", "control"));
        resources["ClayFloatingRadius"] = new CornerRadius(Number("radius", "floating"));
        resources["ClayControlHeight"] = Number("size", "control");
        resources["ClayCompactHeight"] = Number("size", "compact");
        resources["ClayDisabledOpacity"] = Number("state", "disabledOpacity");
        resources["ClayScrollThickness"] = Number("scroll", "thickness");
        var scrollInset = (Number("scroll", "thickness") - Number("scroll", "thumb")) / 2;
        resources["ClayScrollThumbMargin"] = new Thickness(scrollInset);
        resources["ClayScrollMinThumb"] = Number("scroll", "minThumb") + scrollInset * 2;
        resources["ClaySurface"] = CardSurface();
        resources["ClayRaised"] = Raised();
        resources["ClayButtonShadow"] = new DropShadowEffect { BlurRadius = 10, ShadowDepth = 5, Opacity = .33 };
        resources["ClayPrimaryShadow"] = new DropShadowEffect { BlurRadius = 16, ShadowDepth = 7, Opacity = .3, Color = Color("accent") };
        resources["ClayPrimary"] = resources["ClayPanelPrimary"] = Surface(true);
        resources["ClayShadow"] = Shadow();
        resources.MergedDictionaries.Add(new ResourceDictionary
        {
            Source = new Uri("/" + typeof(SoftClayTheme).Assembly.GetName().Name + ";component/SoftClayControls.xaml", UriKind.Relative)
        });
        InstallButtonFeedback();
    }

    // 启动提示与声明式窗口使用完全相同的按钮模板，不再在代码中维护第二套外观。
    public static Style ButtonStyle() => (Style)Application.Current.FindResource("ClayButton");

    // 类处理器仅安装一次；所有共享按钮复用原导轨的按压和释放反馈。
    private static void InstallButtonFeedback()
    {
        if (_buttonFeedbackInstalled) return;
        _buttonFeedbackInstalled = true;
        SoftClayMotion.Install();
        EventManager.RegisterClassHandler(typeof(Button), UIElement.PreviewMouseLeftButtonDownEvent, new MouseButtonEventHandler((sender, _) => AnimatePress((Button)sender, true)));
        EventManager.RegisterClassHandler(typeof(Button), UIElement.PreviewMouseLeftButtonUpEvent, new MouseButtonEventHandler((sender, _) => AnimatePress((Button)sender, false)));
        EventManager.RegisterClassHandler(typeof(Button), UIElement.LostMouseCaptureEvent, new MouseEventHandler((sender, _) => AnimatePress((Button)sender, false)));
        EventManager.RegisterClassHandler(typeof(Button), UIElement.PreviewKeyDownEvent, new KeyEventHandler((sender, e) => { if (e.Key is Key.Space or Key.Enter) AnimatePress((Button)sender, true); }));
        EventManager.RegisterClassHandler(typeof(Button), UIElement.PreviewKeyUpEvent, new KeyEventHandler((sender, e) => { if (e.Key is Key.Space or Key.Enter) AnimatePress((Button)sender, false); }));
    }

    // 固定命中槽位，材质和图文分别响应同源物理弹簧。
    private static void AnimatePress(Button button, bool pressed) => SoftClayMotion.Press(button, pressed);
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
    // 渐变形成凸面，不再额外勾边；所有几何尺寸由调用方按目标 DPI 计算。
    public static void Surface(System.Drawing.Graphics graphics, System.Drawing.RectangleF box, float radius, bool active = false)
    {
        using var path = Rounded(box, radius);
        using var face = new System.Drawing.Drawing2D.LinearGradientBrush(box, Color(active?"accentTop":"surfaceTop"), Color(active?"accentBottom":"surfaceBottom"), 90);
        face.InterpolationColors = new System.Drawing.Drawing2D.ColorBlend
        {
            Colors = active ? [Color("accentTop"), Color("accentBottom"), Color("accentLow")]
                : [Color("surfaceTop"), Color("surfaceMid"), Color("surfaceLow"), Color("surfaceBase")],
            Positions = active ? [0, .35f, 1] : [0, .35f, .7f, 1]
        };
        graphics.FillPath(face, path);
    }
}

// 托盘菜单复用软泥浮卡与线性图标，命令行为仍交由宿主，保留菜单原生键盘导航。
internal static class SoftClayTrayMenu
{
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ContextMenu, DeferredNativeAction> Pending = new();
    public static ContextMenu Create()
    {
        var menu=new ContextMenu{Placement=System.Windows.Controls.Primitives.PlacementMode.MousePoint,StaysOpen=false,HasDropShadow=false,FontFamily=SoftClayTheme.Font};
        SoftClayTheme.Install(menu.Resources);menu.Style=(Style)menu.Resources["ClayTrayMenu"];
        var pending = Pending.GetOrCreateValue(menu);
        menu.Opened += (_, _) => pending.Cancel();
        menu.Closed += (_, _) =>
        {
            // Closed 在真实 Popup HWND 销毁之后触发，截图/对话框命令不能抢在退场前执行。
            if (pending.Take() is { } action) menu.Dispatcher.BeginInvoke(action);
        };
        return menu;
    }
    public static MenuItem Command(string label,string geometry,Action action,string shortcut="")
    {
        var icon=new System.Windows.Shapes.Path{Data=Geometry.Parse(geometry),Stroke=SoftClayTheme.Brush("ink"),StrokeThickness=1.8,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,StrokeLineJoin=PenLineJoin.Round};
        var item=new MenuItem{Header=label,InputGestureText=shortcut,Icon=new Viewbox{Width=16,Height=16,Child=new Canvas{Width=24,Height=24,Children={icon}}}};
        item.Click+=(_,_)=>
        {
            if (ItemsControl.ItemsControlFromItemContainer(item) is ContextMenu menu && menu.IsVisible && Pending.TryGetValue(menu, out var pending))
            { pending.Set(action); menu.SetCurrentValue(ContextMenu.IsOpenProperty, false); }
            else action();
        };
        return item;
    }
    public static Separator Divider(ContextMenu menu)=>new(){Style=(Style)menu.Resources["ClayTraySeparator"]};
}
