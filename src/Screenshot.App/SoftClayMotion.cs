using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;

namespace Screenshot.App;

/// <summary>原生控件只复用 v2 运动语义，颜色和尺寸仍来自生产主题。</summary>
internal static class SoftClayMotion
{
    private static readonly JsonDocument Tokens = JsonDocument.Parse(typeof(SoftClayMotion).Assembly.GetManifestResourceStream("Screenshot.LiquidMotionTokens")
        ?? throw new InvalidOperationException("缺少共享动效参数。"));
    private static JsonElement Motion => Tokens.RootElement.GetProperty("motion");
    // 嵌入参数在进程内不变；只解析一次求解器数值，避免每轴、每帧重复查找 JSON。
    private static readonly JsonElement Solver = Motion.GetProperty("solver");
    private static readonly double MaxElapsed = Solver.GetProperty("maxElapsed").GetDouble();
    private static readonly double MaxStep = Solver.GetProperty("maxStep").GetDouble();
    private static readonly double PositionEpsilon = Solver.GetProperty("positionEpsilon").GetDouble();
    private static readonly double VelocityEpsilon = Solver.GetProperty("velocityEpsilon").GetDouble();
    // 首次框选与网页移动框选共用软边幅度和显现参数。
    internal static JsonElement SelectionTokens => Motion.GetProperty("selection");
    internal static JsonElement RailButtonTokens => Motion.GetProperty("railButton");
    internal static JsonElement FieldTokens => Motion.GetProperty("field");
    internal static JsonElement PressTokens => Motion.GetProperty("press");
    // 弱表保留重定向状态；只有尚未停稳的控件进入活动帧列表。
    private static readonly ConditionalWeakTable<ButtonBase, SurfaceState> Buttons = new();
    private static readonly ConditionalWeakTable<FrameworkElement, FloatingSurface> Surfaces = new();
    private static readonly List<WeakReference<SurfaceState>> Known = new();
    private static readonly Dictionary<FrameworkElement, SurfaceState> Active = new();
    private static readonly Dictionary<FrameworkElement, Func<double, bool>> Timelines = new();
    private static bool _installed, _rendering;
    private static long _last;
    internal static double Duration(string name) => Motion.GetProperty("duration").GetProperty(name).GetDouble() / 1000;

    /// <summary>仅安装视觉事件，不创建窗口、读取剪贴板或注册系统快捷键。</summary>
    public static void Install()
    {
        if (_installed) return;
        _installed = true;
        EventManager.RegisterClassHandler(typeof(ButtonBase), UIElement.MouseMoveEvent, new MouseEventHandler((sender, args) => Hover((ButtonBase)sender, args.GetPosition((ButtonBase)sender))));
        EventManager.RegisterClassHandler(typeof(ButtonBase), UIElement.MouseLeaveEvent, new MouseEventHandler((sender, _) => Hover((ButtonBase)sender, null)));
        EventManager.RegisterClassHandler(typeof(ButtonBase), FrameworkElement.LoadedEvent, new RoutedEventHandler((sender, _) => State((ButtonBase)sender)));
        EventManager.RegisterClassHandler(typeof(ToggleButton), ToggleButton.CheckedEvent, new RoutedEventHandler((sender, _) => TurnChevron((ToggleButton)sender)));
        EventManager.RegisterClassHandler(typeof(ToggleButton), ToggleButton.UncheckedEvent, new RoutedEventHandler((sender, _) => TurnChevron((ToggleButton)sender)));
        EventManager.RegisterClassHandler(typeof(ButtonBase), FrameworkElement.UnloadedEvent, new RoutedEventHandler((sender, _) =>
        {
            var button = (ButtonBase)sender;
            Active.Remove(button);
            if (Buttons.TryGetValue(button, out var state)) state.Reset();
            SleepIfSettled();
        }));
        SystemParameters.StaticPropertyChanged += SystemMotionChanged;
    }

    // 每个按钮只创建一组独立表面变换，弱引用不会阻止窗口释放。
    private static SurfaceState? State(ButtonBase owner)
    {
        if (owner is SoftClayRailButton) return null; // 轨道适配已有同钟受力，不能再叠一层普通按钮变换。
        if (Buttons.TryGetValue(owner, out var existing)) return existing;
        owner.ApplyTemplate();
        var face = owner.Template?.FindName("Face", owner) as FrameworkElement;
        if (face is null) return null; // 滚动条等透明命中按钮没有材质，不进入帧循环。
        var glyph = owner.Template!.FindName("Glyph", owner) as FrameworkElement;
        var arrow = owner.Template.FindName("Arrow", owner) as FrameworkElement;
        var state = new SurfaceState(owner, face, glyph, arrow);
        Buttons.Add(owner, state);
        void ResetUnavailable(object sender, DependencyPropertyChangedEventArgs args)
        {
            if (owner.IsEnabled && owner.IsVisible) return;
            state.Reset(); Active.Remove(owner); SleepIfSettled();
        }
        owner.IsEnabledChanged += ResetUnavailable; owner.IsVisibleChanged += ResetUnavailable;
        Known.RemoveAll(reference => !reference.TryGetTarget(out _));
        Known.Add(new WeakReference<SurfaceState>(state));
        return state;
    }

    /// <summary>输入槽位不移动；按住冻结迎向，释放从当前状态回落。</summary>
    public static void Press(ButtonBase button, bool pressed)
    {
        var state = State(button);
        if (state is null) return;
        if (!button.IsEnabled) { state.Reset(); Active.Remove(button); SleepIfSettled(); return; }
        state.Pressed = pressed;
        state.ScaleX.To = pressed ? Motion.GetProperty("press").GetProperty("x").GetDouble() : 1;
        state.ScaleY.To = pressed ? Motion.GetProperty("press").GetProperty("y").GetDouble() : 1;
        if (pressed) { state.X.Snap(state.X.Value); state.Y.Snap(state.Y.Value); }
        else { state.X.To = 0; state.Y.To = 0; }
        Wake(state);
    }
    private static void TurnChevron(ToggleButton button)
    {
        var state = State(button);
        if (state is null) return;
        state.Chevron.Redirect(button.IsChecked == true ? 1 : 0);
        Wake(state);
    }

    // 由事件提供的控件内坐标计算有界迎向，不读取或移动系统光标。
    private static void Hover(ButtonBase button, Point? pointer)
    {
        if (!button.IsEnabled || !SystemParameters.ClientAreaAnimation) return;
        var state = State(button);
        if (state is null || state.Pressed) return;
        var field = Motion.GetProperty("field");
        var dx = pointer?.X - button.ActualWidth / 2 ?? 0;
        var dy = pointer?.Y - button.ActualHeight / 2 ?? 0;
        var attention = pointer.HasValue ? Math.Pow(Math.Max(0, 1 - Math.Sqrt(dx * dx + dy * dy) / field.GetProperty("radius").GetDouble()), 2) : 0;
        state.X.To = Math.Clamp(dx / Math.Max(1, button.ActualWidth * .7), -1, 1) * attention * field.GetProperty("shiftX").GetDouble();
        state.Y.To = Math.Clamp(dy / Math.Max(1, button.ActualHeight * .7), -1, 1) * attention * field.GetProperty("shiftY").GetDouble();
        Wake(state);
    }

    /// <summary>同一表面重开时取消旧退场，从当前材质、正文与矩形继续。</summary>
    public static void EnterSurface(FrameworkElement owner, FrameworkElement face, FrameworkElement glyph)
    {
        if (!Surfaces.TryGetValue(owner, out var state) || state.Face != face || state.Glyph != glyph)
        {
            StopSurface(owner); state = new FloatingSurface(face, glyph); Surfaces.Add(owner, state);
        }
        state.Transition.Open(); state.Paint();
        Animate(owner, dt => { state.Transition.Step(dt); state.Paint(); return state.Transition.Moving; });
    }
    public static void ExitSurface(FrameworkElement owner, double duration, double directionX, double directionY, Action? completed = null)
    {
        if (!Surfaces.TryGetValue(owner, out var state)) { completed?.Invoke(); return; }
        state.Transition.Close(duration, directionX, directionY);
        Animate(owner, dt =>
        {
            state.Transition.Step(dt); state.Paint();
            if (state.Transition.Moving) return true;
            completed?.Invoke(); return false;
        });
    }
    public static void StopSurface(FrameworkElement owner)
    {
        Timelines.Remove(owner);
        if (Surfaces.TryGetValue(owner, out var state)) { state.Paint(NativeSurfaceFrame.Open); Surfaces.Remove(owner); }
        SleepIfSettled();
    }
    /// <summary>折叠等局部布局过渡共用合成订阅，隐藏/卸载或减少动态时归到语义终态。</summary>
    public static void Animate(FrameworkElement owner, Func<double, bool> advance)
    {
        Timelines.Remove(owner);
        if (!owner.IsLoaded || !owner.IsVisible || !SystemParameters.ClientAreaAnimation) { advance(double.PositiveInfinity); SleepIfSettled(); return; }
        if (!advance(0)) { SleepIfSettled(); return; }
        Timelines[owner] = advance; StartRendering();
    }
    public static void StopTimeline(FrameworkElement owner)
    {
        if (Timelines.Remove(owner, out var advance)) advance(double.PositiveInfinity);
        SleepIfSettled();
    }

    // 仅活动表面订阅合成帧；系统关闭动画时同步复位。
    private static void Wake(SurfaceState state)
    {
        if (!state.Owner.IsLoaded || !state.Owner.IsVisible || !SystemParameters.ClientAreaAnimation) { state.Reset(); Active.Remove(state.Owner); SleepIfSettled(); return; }
        Active[state.Owner] = state;
        StartRendering();
    }
    private static void StartRendering()
    {
        if (_rendering) return;
        _last = Stopwatch.GetTimestamp(); _rendering = true;
        CompositionTarget.Rendering += Render;
    }

    /// <summary>同一原生帧循环使用 v2 的有界步长；所有控件停稳后解除渲染订阅。</summary>
    private static void Render(object? sender, EventArgs args)
    {
        var now = Stopwatch.GetTimestamp();
        var elapsed = Math.Min(MaxElapsed, (now - _last) / (double)Stopwatch.Frequency);
        _last = now;
        foreach (var pair in Active.ToArray())
        {
            var state = pair.Value;
            if (!state.Owner.IsLoaded || !state.Owner.IsVisible || !state.Owner.IsEnabled || !SystemParameters.ClientAreaAnimation) { state.Reset(); Active.Remove(pair.Key); continue; }
            var config = Motion.GetProperty("spring").GetProperty(state.Pressed ? "press" : "attention");
            var moving = state.X.Step(elapsed, config);
            moving = state.Y.Step(elapsed, config) || moving;
            var press = Motion.GetProperty("spring").GetProperty("press");
            moving = state.ScaleX.Step(elapsed, press) || moving;
            moving = state.ScaleY.Step(elapsed, press) || moving;
            state.Chevron.Step(elapsed); moving = state.Chevron.Moving || moving;
            state.Paint();
            if (!moving) Active.Remove(pair.Key);
        }
        foreach (var pair in Timelines.ToArray())
        {
            if (!Timelines.TryGetValue(pair.Key, out var current) || current != pair.Value) continue;
            var dt = pair.Key.IsLoaded && pair.Key.IsVisible && SystemParameters.ClientAreaAnimation ? elapsed : double.PositiveInfinity;
            if (!pair.Value(dt) && Timelines.TryGetValue(pair.Key, out current) && current == pair.Value) Timelines.Remove(pair.Key);
        }
        SleepIfSettled();
    }

    private static void SleepIfSettled()
    {
        if (Active.Count != 0 || Timelines.Count != 0 || !_rendering) return;
        CompositionTarget.Rendering -= Render; _rendering = false;
    }

    // 系统偏好优先，连已经休眠的偏移表面也立即恢复。
    private static void SystemMotionChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName != nameof(SystemParameters.ClientAreaAnimation) || SystemParameters.ClientAreaAnimation) return;
        // 系统选项切换时连已经休眠的迎向表面也复位，不能留下偏移。
        foreach (var reference in Known) if (reference.TryGetTarget(out var state)) state.Reset();
        foreach (var state in Active.Values) state.Reset();
        foreach (var pair in Timelines.ToArray()) { Timelines.Remove(pair.Key); pair.Value(double.PositiveInfinity); }
        Active.Clear(); SleepIfSettled();
    }

    /// <summary>材质独立缩放，图文仅以 0.38 比例平移；透明根槽位始终固定。</summary>
    private sealed class SurfaceState
    {
        public readonly FrameworkElement Owner;
        public readonly SpringState X = new(), Y = new(), ScaleX = new(1), ScaleY = new(1);
        // 箭头翻转带一次衰减回弹，与网页折叠标识共用 panel 弹簧。
        public readonly DisclosureTransition Chevron = new("panel", false);
        public readonly TranslateTransform Shift = new();
        private readonly ScaleTransform _scale = new(1, 1);
        private readonly TranslateTransform _glyphShift = new();
        private readonly RotateTransform _arrowTurn = new();
        // 长下拉字段常贴近滚动边缘，材质只在自己的固定槽位内形变。
        private readonly bool _isComboTrigger;
        public bool Pressed;

        // 命中网格不参与变换；材质与图文分别挂接到模板零件。
        public SurfaceState(ButtonBase owner, FrameworkElement face, FrameworkElement? glyph, FrameworkElement? arrow)
        {
            Owner = owner; _isComboTrigger = owner.TemplatedParent is ComboBox;
            if (face != null)
            {
                face.RenderTransformOrigin = new Point(.5, .5);
                face.RenderTransform = new TransformGroup { Children = { _scale, Shift } };
            }
            if (glyph != null) glyph.RenderTransform = _glyphShift;
            if (arrow != null)
            {
                Chevron.Redirect(owner is ToggleButton { IsChecked: true } ? 1 : 0); Chevron.Step(double.PositiveInfinity);
                arrow.RenderTransformOrigin = new Point(.5, .5); arrow.RenderTransform = _arrowTurn;
                _arrowTurn.Angle = Chevron.Value * 180;
            }
        }

        // 下拉底板的缩放与平移合并限幅，保证圆角不会越出槽位被 ScrollViewer 剪平。
        public void Paint()
        {
            var x = X.Value; var y = Y.Value;
            var scaleX = ScaleX.Value; var scaleY = ScaleY.Value; var pressDepth = 0d;
            if (_isComboTrigger)
            {
                var width = Math.Max(1, Owner.ActualWidth); var height = Math.Max(1, Owner.ActualHeight);
                x = Math.Clamp(x, -width / 2, width / 2); y = Math.Clamp(y, -height / 2, height / 2);
                // 以中心缩放后再平移，任一侧的可见边界都不得越过原输入区域。
                scaleX = Math.Clamp(Math.Min(scaleX, 1 - 2 * Math.Abs(x) / width), 0, 1);
                scaleY = Math.Clamp(Math.Min(scaleY, 1 - 2 * Math.Abs(y) / height), 0, 1);
                // 与网页下拉相同，按下只让图文轻沉，不缩放选中文字或改变点击范围。
                pressDepth = Math.Clamp((1 - ScaleY.Value) / (1 - Motion.GetProperty("press").GetProperty("y").GetDouble()), 0, 1) * 1.2;
            }
            Shift.X = x; Shift.Y = y; _scale.ScaleX = scaleX; _scale.ScaleY = scaleY;
            var ratio = Motion.GetProperty("field").GetProperty("iconRatio").GetDouble();
            _glyphShift.X = x * ratio; _glyphShift.Y = y * ratio + pressDepth;
            _arrowTurn.Angle = Chevron.Value * 180;
        }

        public void Reset()
        {
            X.Snap(0); Y.Snap(0); ScaleX.Snap(1); ScaleY.Snap(1); Chevron.Step(double.PositiveInfinity); Pressed = false; Paint();
        }
    }

    // 浮层和按钮共用同一帧调度；浮层额外保留独立透明度，提前退出不重新点亮材质。
    private sealed class FloatingSurface
    {
        public readonly FrameworkElement Face, Glyph;
        public readonly NativeSurfaceTransition Transition = new();
        private readonly ScaleTransform _scale = new(1, 1);
        private readonly TranslateTransform _shift = new(), _glyphShift = new();
        public FloatingSurface(FrameworkElement face, FrameworkElement glyph)
        {
            Face = face; Glyph = glyph;
            face.RenderTransformOrigin = new Point(.5, .5);
            face.RenderTransform = new TransformGroup { Children = { _scale, _shift } };
            glyph.RenderTransform = _glyphShift;
        }
        public void Paint() => Paint(Transition.Frame);
        public void Paint(NativeSurfaceFrame frame)
        {
            _shift.X = frame.X; _shift.Y = frame.Y; _scale.ScaleX = frame.ScaleX; _scale.ScaleY = frame.ScaleY;
            var ratio = Motion.GetProperty("field").GetProperty("iconRatio").GetDouble();
            _glyphShift.X = frame.X * ratio; _glyphShift.Y = frame.Y * ratio;
            Face.Opacity = frame.Material; Glyph.Opacity = frame.Content;
        }
    }

    /// <summary>与 React 相同的质量为 1 半隐式欧拉求解与停稳阈值。</summary>
    internal sealed class SpringState
    {
        public double Value, Velocity, To;
        public SpringState(double value = 0) { Value = To = value; }
        public void Snap(double value) { Value = To = value; Velocity = 0; }
        public bool Moving => Value != To || Velocity != 0;
        public bool Step(double elapsed, string preset) => Step(elapsed, Motion.GetProperty("spring").GetProperty(preset));
        public bool Step(double elapsed, JsonElement config)
        {
            elapsed = Math.Clamp(elapsed, 0, MaxElapsed);
            var steps = Math.Max(1, (int)Math.Ceiling(elapsed / MaxStep));
            var step = elapsed / steps;
            var k = config.GetProperty("k").GetDouble(); var c = config.GetProperty("c").GetDouble();
            for (var index = 0; index < steps; index++)
            {
                Velocity += (-k * (Value - To) - c * Velocity) * step;
                Value += Velocity * step;
            }
            if (Math.Abs(Value - To) < PositionEpsilon && Math.Abs(Velocity) < VelocityEpsilon) Snap(To);
            return Value != To || Velocity != 0;
        }
    }
}
