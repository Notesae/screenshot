using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using Path = System.Windows.Shapes.Path;

namespace Screenshot.App;

/// <summary>轨道按钮的原生适配：共用参数、求解器与时钟，命中槽位和业务点击保持即时。</summary>
public sealed class SoftClayRailButton : Button
{
    public static readonly DependencyProperty IsSelectedProperty = DependencyProperty.Register(
        nameof(IsSelected), typeof(bool), typeof(SoftClayRailButton), new PropertyMetadata(false));
    public bool IsSelected { get => (bool)GetValue(IsSelectedProperty); set => SetValue(IsSelectedProperty, value); }

    // 与 LiquidMotion / RailIconMotion 读取相同数值；帧内不重复解析 JSON。
    private static readonly double Radius = SoftClayMotion.FieldTokens.GetProperty("radius").GetDouble(),
        ShiftX = SoftClayMotion.FieldTokens.GetProperty("shiftX").GetDouble(), ShiftY = SoftClayMotion.FieldTokens.GetProperty("shiftY").GetDouble(),
        MaxShift = SoftClayMotion.FieldTokens.GetProperty("maxShift").GetDouble(), Stretch = SoftClayMotion.FieldTokens.GetProperty("stretch").GetDouble(),
        IconRatio = SoftClayMotion.FieldTokens.GetProperty("iconRatio").GetDouble(),
        PressX = SoftClayMotion.PressTokens.GetProperty("x").GetDouble(), PressY = SoftClayMotion.PressTokens.GetProperty("y").GetDouble(),
        StretchX = SoftClayMotion.RailButtonTokens.GetProperty("stretchX").GetDouble(), StretchY = SoftClayMotion.RailButtonTokens.GetProperty("stretchY").GetDouble(),
        PressDepth = SoftClayMotion.RailButtonTokens.GetProperty("pressDepth").GetDouble();
    private static readonly System.Text.Json.JsonElement IconTokens = SoftClayMotion.RailButtonTokens.GetProperty("icon");
    private static readonly double HoverDuration = IconNumber("hover") / 1000, FocusDuration = IconNumber("focus") / 1000, ClickDuration = IconNumber("click") / 1000,
        HeldForce = IconNumber("pressed"), ForceLimit = IconNumber("forceLimit"), LagLimit = IconNumber("lagLimit"),
        PartShiftX = IconNumber("shiftX"), PartShiftY = IconNumber("shiftY"), PartTurn = IconNumber("turn"), PartSkew = IconNumber("skew"),
        PartStretch = IconNumber("stretch"), CrossStretch = IconNumber("crossStretch"), PinTurn = IconNumber("pinTurn"),
        BendShift = IconNumber("bendShift"), CrossTurn = IconNumber("crossTurn");
    private static double IconNumber(string name) => IconTokens.GetProperty(name).GetDouble();

    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _pullX = new(), _pullY = new(), _attention = new(),
        _press = new(), _selected = new(), _focus = new(), _force = new(), _tail = new();
    private readonly SoftClayMotion.SpringState[] _springs;
    private readonly SoftClayMotion.SpringState[] _positionSprings;
    private readonly List<IconPart> _parts = new();
    private readonly ScaleTransform _scale = new(1, 1);
    private readonly TranslateTransform _shift = new(), _glyphShift = new();
    private readonly RadialGradientBrush _light = new(Colors.White, Colors.Transparent) { RadiusX = 1, RadiusY = 1 };
    private FrameworkElement? _face, _glyph;
    private SoftClaySurface[] _layers = [];
    private string _iconKind = "";
    private Point? _pointer;
    private double _pulse;
    private bool _nearest, _keyboardFocus;

    public SoftClayRailButton()
    {
        _springs = [_x, _y, _pullX, _pullY, _attention, _press, _selected, _focus, _force, _tail];
        _positionSprings = [_x, _y, _pullX, _pullY, _attention];
        Loaded += (_, _) => { SystemParameters.StaticPropertyChanged += MotionChanged; Settle(); };
        Unloaded += (_, _) => { SystemParameters.StaticPropertyChanged -= MotionChanged; SoftClayMotion.StopTimeline(this); Settle(); };
    }

    public override void OnApplyTemplate()
    {
        base.OnApplyTemplate();
        _face = GetTemplateChild("RailFace") as FrameworkElement;
        _glyph = GetTemplateChild("RailGlyph") as FrameworkElement;
        _layers = new[] { "RailBase", "RailRaised", "RailColor", "RailPrimary", "RailDepth", "RailLight", "RailFocus" }
            .Select(name => GetTemplateChild(name)).OfType<SoftClaySurface>().ToArray();
        if (_face is null || _glyph is null || _layers.Length != 7) return;
        _face.RenderTransformOrigin = new Point(.5, .5);
        _face.RenderTransform = new TransformGroup { Children = { _scale, _shift } };
        _glyph.RenderTransform = _glyphShift; _layers[5].Background = _light;
        Paint();
    }

    /// <summary>图标按真实线条拆成部件，沿用轨道的分合、弯转和滞后公式。</summary>
    internal void SetIcon(string kind, params string[] geometries)
    {
        _iconKind = kind; _parts.Clear();
        var canvas = new Canvas { Width = 24, Height = 24 };
        foreach (var geometry in geometries)
        {
            var path = new Path { Data = Geometry.Parse(geometry), StrokeThickness = 1.8,
                StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round };
            path.SetBinding(Shape.StrokeProperty, new Binding(nameof(Foreground)) { Source = this });
            _parts.Add(new IconPart(path, _parts.Count)); canvas.Children.Add(path);
        }
        Content = new Viewbox { Width = 18, Height = 18, Child = canvas };
    }

    /// <summary>整组从同一指针事件测量；布局移入不另播图标，搬动后仅清除旧位置余振。</summary>
    internal static Action Attach(Panel rail)
    {
        var buttons = rail.Children.OfType<SoftClayRailButton>().ToArray();
        Point? previous = null; SoftClayRailButton? hovered = null; Window? window = null;
        void Rebase(object? sender, EventArgs args)
        {
            previous = null; hovered = null;
            foreach (var button in buttons) button.RebasePointer();
        }
        rail.MouseMove += (_, args) =>
        {
            var pointer = args.GetPosition(rail);
            if (previous is { } last && (pointer - last).Length < .75) return;
            previous = pointer;
            var points = buttons.Select(button => args.GetPosition(button)).ToArray();
            var nearest = Enumerable.Range(0, buttons.Length).Where(index => buttons[index].IsEnabled)
                .OrderBy(index => Math.Pow(points[index].X - buttons[index].ActualWidth / 2, 2) + Math.Pow(points[index].Y - buttons[index].ActualHeight / 2, 2)).FirstOrDefault(-1);
            var target = buttons.FirstOrDefault(button => button.IsMouseOver && button.IsEnabled);
            if (target != hovered) { hovered = target; target?.Pulse(HoverDuration); }
            var held = buttons.Any(button => button.IsPressed);
            for (var index = 0; index < buttons.Length; index++) buttons[index].Hover(held && !buttons[index].IsPressed ? null : points[index], index == nearest);
        };
        rail.MouseLeave += (_, _) => { hovered = null; foreach (var button in buttons) button.Hover(null, false); };
        rail.Loaded += (_, _) => { window = Window.GetWindow(rail); if (window is not null) window.Deactivated += Rebase; };
        rail.Unloaded += (_, _) => { if (window is not null) window.Deactivated -= Rebase; window = null; Rebase(null, EventArgs.Empty); };
        return () => Rebase(null, EventArgs.Empty);
    }

    private void Hover(Point? pointer, bool nearest)
    {
        _pointer = pointer; _nearest = nearest;
        if (IsPressed) return;
        var dx = pointer?.X - ActualWidth / 2 ?? 0; var dy = pointer?.Y - ActualHeight / 2 ?? 0;
        var attention = pointer.HasValue ? Math.Pow(Math.Clamp(1 - Math.Sqrt(dx * dx + dy * dy) / Radius, 0, 1), 2) : 0;
        _attention.To = attention;
        _pullX.To = Math.Clamp(dx / Math.Max(1, ActualWidth * .7), -1, 1) * attention;
        _pullY.To = Math.Clamp(dy / Math.Max(1, ActualHeight * .7), -1, 1) * attention;
        _x.To = Math.Clamp(_pullX.To * ShiftX, -MaxShift, MaxShift); _y.To = _pullY.To * ShiftY;
        if (pointer is { } point)
        {
            _light.Center = _light.GradientOrigin = new Point(Math.Clamp(point.X / Math.Max(1, ActualWidth), 0, 1), Math.Clamp(point.Y / Math.Max(1, ActualHeight), 0, 1));
            _light.RadiusX = 40 / Math.Max(1, ActualWidth); _light.RadiusY = 40 / Math.Max(1, ActualHeight);
        }
        Wake();
    }

    private void RebasePointer()
    {
        foreach (var spring in _positionSprings) spring.Snap(0);
        _pointer = null; _nearest = false; Paint();
    }

    protected override void OnPropertyChanged(DependencyPropertyChangedEventArgs args)
    {
        base.OnPropertyChanged(args);
        if (_face is null) return;
        // 按住移出时先记住真实落点；捕获结束后卸力，避免保留一张永久悬停的表面。
        if (args.Property == IsPressedProperty && !IsPressed) Hover(_pointer, _nearest);
        else if (args.Property == IsPressedProperty || args.Property == IsSelectedProperty || args.Property == IsKeyboardFocusedProperty) Wake();
        else if ((args.Property == IsEnabledProperty && !IsEnabled) || (args.Property == IsVisibleProperty && !IsVisible))
        { SoftClayMotion.StopTimeline(this); Settle(); }
    }

    protected override void OnGotKeyboardFocus(KeyboardFocusChangedEventArgs args)
    {
        base.OnGotKeyboardFocus(args);
        _keyboardFocus = InputManager.Current.MostRecentInputDevice is KeyboardDevice;
        if (_keyboardFocus) Pulse(FocusDuration);
    }
    protected override void OnPreviewMouseLeftButtonDown(MouseButtonEventArgs args)
    { _keyboardFocus = false; base.OnPreviewMouseLeftButtonDown(args); Wake(); }
    protected override void OnPreviewKeyDown(KeyEventArgs args)
    { _keyboardFocus = true; base.OnPreviewKeyDown(args); Wake(); }
    protected override void OnClick() { Pulse(ClickDuration); base.OnClick(); }

    private void Pulse(double duration) { _pulse = duration; Wake(); }
    private void Wake() { if (_face is not null) SoftClayMotion.Animate(this, Step); }
    private void MotionChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName == nameof(SystemParameters.ClientAreaAnimation) && !SystemParameters.ClientAreaAnimation)
        { SoftClayMotion.StopTimeline(this); Settle(); }
    }

    // 与轨道一样只改目标；连续按压、反向与置顶切换不重置位移或速度。
    private bool Step(double elapsed)
    {
        if (!double.IsFinite(elapsed) || !IsEnabled || !IsVisible) { Settle(); return false; }
        _pulse = Math.Max(0, _pulse - elapsed);
        _press.To = IsPressed ? 1 : 0; _selected.To = IsSelected ? 1 : 0; _focus.To = IsKeyboardFocused && _keyboardFocus ? 1 : 0;
        _force.To = IsPressed ? HeldForce : _pulse > 0 ? 1 : 0;
        var preset = _nearest ? "attention" : "neighbor";
        foreach (var spring in _positionSprings) spring.Step(elapsed, preset);
        _press.Step(elapsed, "press"); _selected.Step(elapsed, "indicator"); _focus.Step(elapsed, "body");
        _force.Step(elapsed, IsPressed ? "press" : "toolRecoil"); _tail.To = _force.Value; _tail.Step(elapsed, "selection");
        Paint(); return _pulse > 0 || _springs.Any(spring => spring.Moving);
    }

    // 隐藏、卸载和减少动态直接归到语义终态，停稳后不保留空转帧。
    private void Settle()
    {
        foreach (var spring in _springs) spring.Snap(0);
        _selected.Snap(IsSelected ? 1 : 0); _pulse = 0; _pointer = null; _nearest = false; Paint();
    }

    private void Paint()
    {
        if (_face is null || _layers.Length != 7) return;
        var limit = Math.Min(1, MaxShift / Math.Max(.001, Math.Sqrt(_x.Value * _x.Value + _y.Value * _y.Value)));
        _shift.X = _x.Value * limit; _shift.Y = _y.Value * limit;
        _scale.ScaleX = 1 + Stretch * _attention.Value * StretchX + (PressX - 1) * _press.Value;
        _scale.ScaleY = 1 + Stretch * (Math.Abs(_pullY.Value) - StretchY * _attention.Value) + (PressY - 1) * _press.Value;
        _glyphShift.X = _shift.X * IconRatio; _glyphShift.Y = _shift.Y * IconRatio + _press.Value * PressDepth;
        var depth = Math.Clamp(_press.Value, 0, 1); var selected = Math.Clamp(_selected.Value, 0, 1);
        _layers[1].Opacity = (1 - depth) * (1 - selected); _layers[2].Opacity = selected;
        _layers[3].Opacity = selected * (1 - depth); _layers[4].Opacity = depth;
        _layers[5].Opacity = Math.Clamp(_attention.Value * .95, 0, .8); _layers[6].Opacity = Math.Clamp(_focus.Value, 0, 1);
        foreach (var layer in _layers) layer.RailBend = _pullX.Value;
        var force = ForceLimit * Math.Tanh(_force.Value / ForceLimit);
        var lag = LagLimit * Math.Tanh((_force.Value - _tail.Value) / LagLimit);
        foreach (var part in _parts) part.Paint(_iconKind, force, lag);
    }

    // 变换顺序对应 SVG 的 translate / rotate / skew / scale；中心固定在 24px viewBox。
    private sealed class IconPart
    {
        private readonly double _x, _y;
        private readonly int _index;
        private readonly ScaleTransform _scale = new(1, 1, 12, 12);
        private readonly SkewTransform _skew = new(0, 0, 12, 12);
        private readonly RotateTransform _turn = new(0, 12, 12);
        private readonly TranslateTransform _shift = new();
        public IconPart(Path path, int index)
        {
            var bounds = path.Data.Bounds;
            _x = Math.Clamp((bounds.X + bounds.Width / 2) / 12 - 1, -1, 1); _y = Math.Clamp((bounds.Y + bounds.Height / 2) / 12 - 1, -1, 1); _index = index;
            path.RenderTransform = new TransformGroup { Children = { _scale, _skew, _turn, _shift } };
        }
        public void Paint(string kind, double force, double lag)
        {
            var dx = _x * lag * PartShiftX; var dy = _y * lag * PartShiftY;
            var turn = lag * PartTurn; var stretch = 1 + force * PartStretch;
            if (kind == "pin") { turn += force * PinTurn; dx += _y * lag * BendShift; }
            else if (kind is "close" or "plus") { turn += (_index % 2 == 1 ? 1 : -1) * force * CrossTurn; stretch = 1 + force * CrossStretch; }
            _scale.ScaleX = stretch; _scale.ScaleY = 1 / stretch; _skew.AngleX = lag * PartSkew;
            _turn.Angle = turn; _shift.X = dx; _shift.Y = dy;
        }
    }
}
