using System;

namespace Screenshot.App;

internal readonly record struct NativeSurfaceFrame(double X, double Y, double ScaleX, double ScaleY, double Material, double Content)
{
    public static NativeSurfaceFrame Open => new(0, 0, 1, 1, 1, 1);
}

/// <summary>原生浮层的纯表现状态；入退场都从当前材质、正文和位移续接。</summary>
internal sealed class NativeSurfaceTransition
{
    internal const double WindowExitSeconds = .17;
    // WPF 透明 Popup 的公开 Fade 模式保留 HWND 150ms，局部回收在其销毁前完成。
    internal const double PopupExitSeconds = .14;
    private readonly SoftClayMotion.SpringState _progress = new();
    // 缩放以百分数积分，让共享位置阈值不会过早截断到千分之三的缩放差。
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(6), _scaleX = new(96), _scaleY = new(94);
    private NativeSurfaceFrame _from, _to;
    private double _elapsed, _duration;
    private bool _opening;
    public NativeSurfaceFrame Frame { get; private set; } = new(0, 6, .96, .94, 0, 0);
    public bool Moving { get; private set; }
    internal (double X, double Y, double ScaleX, double ScaleY) Velocity => (_x.Velocity, _y.Velocity, _scaleX.Velocity / 100, _scaleY.Velocity / 100);

    public void Open()
    {
        if (Frame == NativeSurfaceFrame.Open) { Moving = false; return; }
        if (!_opening || !Moving) { _from = Frame; _progress.Snap(0); _progress.To = 1; }
        _to = NativeSurfaceFrame.Open;
        // 几何不借用归零的透明度进度；快速重开保留当前各轴速度。
        _x.To = _y.To = 0; _scaleX.To = _scaleY.To = 100;
        _opening = true; Moving = true;
    }
    /// <summary>收起与打开同为弹簧：几何保留当前速度续接；duration 只是宿主窗口销毁前的截止时刻。</summary>
    public void Close(double duration, double directionX = 0, double directionY = 1)
    {
        if (Moving && !_opening) return;
        _from = Frame;
        _to = Frame with { X = Frame.X + Math.Clamp(directionX, -1, 1) * 6, Y = Frame.Y + Math.Clamp(directionY, -1, 1) * 6,
            ScaleX = Frame.ScaleX * .98, ScaleY = Frame.ScaleY * .97, Material = 0, Content = 0 };
        _x.To = _to.X; _y.To = _to.Y; _scaleX.To = _to.ScaleX * 100; _scaleY.To = _to.ScaleY * 100;
        _progress.Snap(0); _progress.To = 1;
        _duration = Math.Max(0, duration); _elapsed = 0; _opening = false; Moving = true;
    }
    public void Step(double elapsed)
    {
        if (!Moving) return;
        if (double.IsPositiveInfinity(elapsed)) { Finish(); return; }
        double p;
        if (_opening)
        {
            _x.Step(elapsed, "panel"); _y.Step(elapsed, "panel");
            _scaleX.Step(elapsed, "panel"); _scaleY.Step(elapsed, "panel");
            _progress.Step(elapsed, "panel"); p = Math.Clamp(_progress.Value, 0, 1);
            Moving = _progress.Moving || _x.Moving || _y.Moving || _scaleX.Moving || _scaleY.Moving;
        }
        else
        {
            _elapsed += Math.Clamp(elapsed, 0, .05);
            _x.Step(elapsed, "exit"); _y.Step(elapsed, "exit");
            _scaleX.Step(elapsed, "exit"); _scaleY.Step(elapsed, "exit");
            // 可见度以 1.6 倍时间推进，约 90ms 淡尽；截止时刻前几何只剩亚像素余量，交给 Finish 无可见跳变。
            _progress.Step(elapsed * 1.6, "exit"); p = Math.Clamp(_progress.Value, 0, 1);
            Moving = _elapsed < _duration && (_progress.Moving || _x.Moving || _y.Moving || _scaleX.Moving || _scaleY.Moving);
        }
        static double Mix(double from, double to, double value) => from + (to - from) * value;
        Frame = !Moving ? _to : new(_x.Value, _y.Value, _scaleX.Value / 100, _scaleY.Value / 100,
            Mix(_from.Material, _to.Material, _opening ? Math.Clamp(p * 4, 0, 1) : p),
            Mix(_from.Content, _to.Content, _opening ? Math.Clamp((p - .25) / .75, 0, 1) : p));
        if (!Moving) Finish();
    }
    private void Finish()
    {
        Frame = _to; Moving = false;
        _x.Snap(Frame.X); _y.Snap(Frame.Y); _scaleX.Snap(Frame.ScaleX * 100); _scaleY.Snap(Frame.ScaleY * 100);
    }
}
