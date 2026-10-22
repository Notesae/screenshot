using System;
using System.Text.Json;

namespace Screenshot.App;

internal readonly record struct BackdropFrame(double X, double Y, double LightX, double LightY, double Entry);

/// <summary>仅推进背景装饰；输入为归一化指针，永远不修改原图或捕获几何。</summary>
internal sealed class BackdropMotion
{
    private static readonly JsonDocument Tokens = JsonDocument.Parse(typeof(BackdropMotion).Assembly.GetManifestResourceStream("Screenshot.BackgroundMotionTokens")
        ?? throw new InvalidOperationException("缺少背景动效参数。"));
    private static JsonElement Motion => Tokens.RootElement.GetProperty("motion");
    internal static double Padding => Motion.GetProperty("edgePadding").GetDouble();
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _lightX = new(), _lightY = new(), _entry = new(1);
    private double _pointerX, _pointerY;
    private int _quiet;
    public bool Held { get; private set; }
    public BackdropFrame Frame => new(_x.Value, _y.Value + (1 - _entry.Value) * Motion.GetProperty("entry").GetProperty("offsetY").GetDouble(), _lightX.Value, _lightY.Value, _entry.Value);
    internal double VelocityX => _x.Velocity;

    public void Enter() { _entry.Snap(0); _entry.To = 1; _quiet = 0; }
    public void Move(double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return;
        _pointerX = Math.Clamp(x, -1, 1); _pointerY = Math.Clamp(y, -1, 1);
        if (!Held) Target();
    }
    private void Target()
    {
        var desktop = Motion.GetProperty("desktop"); var light = Motion.GetProperty("atmosphere");
        _x.To = _pointerX * desktop.GetProperty("x").GetDouble(); _y.To = _pointerY * desktop.GetProperty("y").GetDouble();
        _lightX.To = _pointerX * light.GetProperty("x").GetDouble(); _lightY.To = _pointerY * light.GetProperty("y").GetDouble();
        _quiet = 0;
    }
    // 按下连入场的可见进度一起冻结，松开从同一姿态接回。
    public void Hold()
    {
        Held = true;
        foreach (var spring in new[] { _x, _y, _lightX, _lightY, _entry }) spring.Snap(spring.Value);
    }
    public void Release() { Held = false; _entry.To = 1; Target(); }
    public void Leave() { Move(0, 0); }
    public void Center() { Held = false; _pointerX = _pointerY = 0; _entry.To = 1; Target(); }
    public void Reset()
    {
        Held = false; _pointerX = _pointerY = 0; _quiet = 0;
        _x.Snap(0); _y.Snap(0); _lightX.Snap(0); _lightY.Snap(0); _entry.Snap(1);
    }
    public bool Step(double elapsed)
    {
        if (!double.IsFinite(elapsed)) { Reset(); return false; }
        if (Held) return false;
        var moving = _x.Step(elapsed, Motion.GetProperty("desktop"));
        moving = _y.Step(elapsed, Motion.GetProperty("desktop")) || moving;
        moving = _lightX.Step(elapsed, Motion.GetProperty("atmosphere")) || moving;
        moving = _lightY.Step(elapsed, Motion.GetProperty("atmosphere")) || moving;
        moving = _entry.Step(elapsed, Motion.GetProperty("entry")) || moving;
        _quiet = moving ? 0 : _quiet + 1;
        return _quiet < Motion.GetProperty("sleepFrames").GetInt32();
    }
}

/// <summary>网页只发运动许可；捕获身份和单调序号拒绝旧外壳的迟到更新。</summary>
internal sealed class BackdropMotionGate
{
    private string? _captureId;
    private long _sequence = -1;
    public bool Enabled { get; private set; }
    public bool Holding { get; private set; }
    public void Reset(string? captureId) { _captureId = captureId; _sequence = -1; Enabled = Holding = false; }
    public bool Apply(string captureId, long sequence, bool enabled, bool holding = false)
    {
        if (_captureId is null || _captureId != captureId || sequence < 0 || sequence > 9_007_199_254_740_991 || sequence <= _sequence) return false;
        _sequence = sequence; Enabled = enabled; Holding = holding; return true;
    }
}
