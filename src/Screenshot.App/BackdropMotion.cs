using System;
using System.Text.Json;

namespace Screenshot.App;

internal readonly record struct BackdropFrame(double X, double Y, double LightX, double LightY, double Entry);

/// <summary>仅推进背景装饰；输入为归一化指针，永远不修改原图或捕获几何。</summary>
internal sealed class BackdropMotion
{
    private static readonly JsonDocument Tokens = JsonDocument.Parse(typeof(BackdropMotion).Assembly.GetManifestResourceStream("Screenshot.BackgroundMotionTokens")
        ?? throw new InvalidOperationException("缺少背景动效参数。"));
    // 嵌入参数在进程内不变；保留原配置交给求解器，只省去逐帧重复查找。
    private static readonly JsonElement Motion = Tokens.RootElement.GetProperty("motion");
    private static readonly JsonElement DesktopConfig = Motion.GetProperty("desktop"), AtmosphereConfig = Motion.GetProperty("atmosphere"), EntryConfig = Motion.GetProperty("entry");
    private static readonly double DesktopX = DesktopConfig.GetProperty("x").GetDouble(), DesktopY = DesktopConfig.GetProperty("y").GetDouble();
    private static readonly double LightX = AtmosphereConfig.GetProperty("x").GetDouble(), LightY = AtmosphereConfig.GetProperty("y").GetDouble();
    private static readonly double EntryOffsetY = EntryConfig.GetProperty("offsetY").GetDouble();
    private static readonly int SleepFrames = Motion.GetProperty("sleepFrames").GetInt32();
    internal static double Padding { get; } = Motion.GetProperty("edgePadding").GetDouble();
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _lightX = new(), _lightY = new(), _entry = new(1);
    private double _pointerX, _pointerY;
    private int _quiet;
    // DIP 到物理像素的比例只用于停稳落点，动画中的位置与速度保持连续。
    private double _pixelScaleX = 1, _pixelScaleY = 1;
    // 记录无新坐标的累计时间，避免指针短暂停顿就改变跟随目标。
    private double _pointerIdle;
    // 每次输入只进行一次像素落点吸附，防止停稳边界来回切换目标。
    private bool _pixelSettling;
    public bool Held { get; private set; }
    public BackdropFrame Frame => new(_x.Value, _y.Value + (1 - _entry.Value) * EntryOffsetY, _lightX.Value, _lightY.Value, _entry.Value);
    internal double VelocityX => _x.Velocity;
    // 暗角可以继续缓移；只有共享图像平面停稳后才允许恢复锐利采样。
    internal bool TranslationSettled => !_x.Moving && !_y.Moving && !_entry.Moving;

    // 切换显示器只重算目标，不重置可见姿态或速度；按下保持期间等松开再接续。
    internal void SetPixelScale(double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y) || x <= 0 || y <= 0 || (_pixelScaleX == x && _pixelScaleY == y)) return;
        _pixelScaleX = x; _pixelScaleY = y;
        if (!Held) Target();
    }

    public void Enter() { _entry.Snap(0); _entry.To = 1; _quiet = 0; _pointerIdle = 0; _pixelSettling = false; }
    public void Move(double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y)) return;
        x = Math.Clamp(x, -1, 1); y = Math.Clamp(y, -1, 1);
        // 重复的路由坐标不延迟停稳；新输入仍只换目标，保留原弹簧速度。
        if (_pointerX == x && _pointerY == y) return;
        _pointerX = x; _pointerY = y;
        if (!Held) Target();
    }
    // 恢复原始跟随目标，并让本次输入重新经历连续运动和临近停稳的像素收敛。
    private void Target()
    {
        _x.To = _pointerX * DesktopX; _y.To = _pointerY * DesktopY;
        _lightX.To = _pointerX * LightX; _lightY.To = _pointerY * LightY;
        _quiet = 0; _pointerIdle = 0; _pixelSettling = false;
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
        Held = false; _pointerX = _pointerY = 0; _quiet = 0; _pointerIdle = 0; _pixelSettling = false;
        _x.Snap(0); _y.Snap(0); _lightX.Snap(0); _lightY.Snap(0); _entry.Snap(1);
    }
    // 保留原逐帧弹簧；输入静止且接近落定后，仅把终点收敛到物理像素网格。
    public bool Step(double elapsed)
    {
        if (!double.IsFinite(elapsed)) { Reset(); return false; }
        if (Held) return false;
        _pointerIdle += Math.Clamp(elapsed, 0, .05);
        var moving = _x.Step(elapsed, DesktopConfig);
        moving = _y.Step(elapsed, DesktopConfig) || moving;
        moving = _lightX.Step(elapsed, AtmosphereConfig) || moving;
        moving = _lightY.Step(elapsed, AtmosphereConfig) || moving;
        moving = _entry.Step(elapsed, EntryConfig) || moving;
        // 80ms 无新坐标、剩余距离不超过半个物理像素且速度低于 2px/s 才微调终点。
        // 不对当前帧取整，也不清速度；新输入会直接取消本次吸附并连续反向。
        if (!_pixelSettling && _pointerIdle >= .08 && !_entry.Moving
            && Math.Abs(_x.To - _x.Value) * _pixelScaleX <= .5 && Math.Abs(_y.To - _y.Value) * _pixelScaleY <= .5
            && Math.Abs(_x.Velocity) * _pixelScaleX <= 2 && Math.Abs(_y.Velocity) * _pixelScaleY <= 2)
        {
            _pixelSettling = true;
            // 幅度边界也落在像素网格内，避免 125% DPI 下向外取整超过原有位移上限。
            var maxX = Math.Floor(DesktopX * _pixelScaleX);
            var maxY = Math.Floor(DesktopY * _pixelScaleY);
            _x.To = Math.Clamp(Math.Round(_x.To * _pixelScaleX, MidpointRounding.AwayFromZero), -maxX, maxX) / _pixelScaleX;
            _y.To = Math.Clamp(Math.Round(_y.To * _pixelScaleY, MidpointRounding.AwayFromZero), -maxY, maxY) / _pixelScaleY;
            moving = _x.Moving || _y.Moving || moving;
        }
        // 极小位移可能先达到原弹簧阈值；完成像素落点处理前不能提前休眠。
        moving = moving || !_pixelSettling;
        _quiet = moving ? 0 : _quiet + 1;
        return _quiet < SleepFrames;
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
