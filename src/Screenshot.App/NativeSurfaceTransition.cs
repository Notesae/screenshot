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
    private NativeSurfaceFrame _from, _to;
    private double _elapsed, _duration;
    private bool _opening;
    public NativeSurfaceFrame Frame { get; private set; } = new(0, 6, .96, .94, 0, 0);
    public bool Moving { get; private set; }

    public void Open()
    {
        if (Frame == NativeSurfaceFrame.Open) { Moving = false; return; }
        _from = Frame; _to = NativeSurfaceFrame.Open;
        _progress.Snap(0); _progress.To = 1; _opening = true; Moving = true;
    }
    public void Close(double duration, double directionX = 0, double directionY = 1)
    {
        if (Moving && !_opening) return;
        _from = Frame;
        _to = Frame with { X = Frame.X + Math.Clamp(directionX, -1, 1) * 6, Y = Frame.Y + Math.Clamp(directionY, -1, 1) * 6,
            ScaleX = Frame.ScaleX * .98, ScaleY = Frame.ScaleY * .97, Material = 0, Content = 0 };
        _duration = Math.Max(0, duration); _elapsed = 0; _opening = false; Moving = true;
    }
    public void Step(double elapsed)
    {
        if (!Moving) return;
        if (double.IsPositiveInfinity(elapsed)) { Frame = _to; Moving = false; return; }
        double p;
        if (_opening)
        {
            _progress.Step(elapsed, "panel"); p = Math.Clamp(_progress.Value, 0, 1);
            Moving = _progress.Moving;
        }
        else
        {
            _elapsed += Math.Clamp(elapsed, 0, .05);
            var time = _duration == 0 ? 1 : Math.Clamp(_elapsed / _duration, 0, 1);
            p = 1 - Math.Pow(1 - time, 3); Moving = time < 1;
        }
        static double Mix(double from, double to, double value) => from + (to - from) * value;
        Frame = !Moving ? _to : new(Mix(_from.X, _to.X, p), Mix(_from.Y, _to.Y, p),
            Mix(_from.ScaleX, _to.ScaleX, p), Mix(_from.ScaleY, _to.ScaleY, p),
            Mix(_from.Material, _to.Material, _opening ? Math.Clamp(p * 4, 0, 1) : p),
            Mix(_from.Content, _to.Content, _opening ? Math.Clamp((p - .25) / .75, 0, 1) : p));
    }
}
