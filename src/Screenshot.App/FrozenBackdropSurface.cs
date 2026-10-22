using System;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Screenshot.App;

/// <summary>原生冻结桌面的显示副本：只移动保留绘图层，边缘拉伸窄条而不放大整张截图。</summary>
public sealed class FrozenBackdropSurface : FrameworkElement
{
    private readonly DrawingGroup _scene = new(), _plane = new(), _atmosphere = new();
    private readonly TranslateTransform _shift = new(), _lightShift = new();
    private readonly BackdropMotion _motion = new();
    private BitmapSource? _source;
    private BitmapSource[] _edges = Array.Empty<BitmapSource>();
    private bool _ready, _allowed, _reduced, _entered;
    public BitmapSource? Source
    {
        get => _source;
        set
        {
            if (ReferenceEquals(value, _source)) return;
            Suspend(); _source = value; _entered = false; _edges = Array.Empty<BitmapSource>();
            if (value is not null)
            {
                var w = value.PixelWidth; var h = value.PixelHeight;
                var rectangles = new[] { new Int32Rect(0, 0, w, 1), new Int32Rect(0, h - 1, w, 1), new Int32Rect(0, 0, 1, h), new Int32Rect(w - 1, 0, 1, h),
                    new Int32Rect(0, 0, 1, 1), new Int32Rect(w - 1, 0, 1, 1), new Int32Rect(0, h - 1, 1, 1), new Int32Rect(w - 1, h - 1, 1, 1) };
                _edges = Array.ConvertAll(rectangles, rectangle => { var edge = new CroppedBitmap(value, rectangle); edge.Freeze(); return (BitmapSource)edge; });
            }
            Rebuild();
        }
    }

    public FrozenBackdropSurface()
    {
        IsHitTestVisible = false; ClipToBounds = true;
        RenderOptions.SetBitmapScalingMode(this, BitmapScalingMode.NearestNeighbor);
        _plane.Transform = _shift; _atmosphere.Transform = _lightShift;
        _scene.Children.Add(_plane); _scene.Children.Add(_atmosphere);
        IsVisibleChanged += (_, _) => { if (!IsVisible) Suspend(); };
        Unloaded += (_, _) => Suspend();
    }

    // 就绪门之前无位移、无暗角，避免把装饰带入首次截图交接的合成帧。
    internal void SetPolicy(bool ready, bool allowed, bool reduced)
    {
        _ready = ready && Source is not null; _allowed = allowed; _reduced = reduced;
        if (!_ready || reduced) { StopAndReset(); return; }
        if (allowed && !_entered) { _entered = true; _motion.Enter(); }
        if (!allowed) _motion.Center();
        Wake();
    }
    internal void Suspend() { _ready = _allowed = false; StopAndReset(); }
    internal void Move(Point point)
    {
        if (!_ready || !_allowed || _reduced || ActualWidth <= 0 || ActualHeight <= 0) return;
        _motion.Move(point.X / ActualWidth * 2 - 1, point.Y / ActualHeight * 2 - 1); Wake();
    }
    internal void Hold()
    {
        if (!_ready || !_allowed || _reduced) return;
        // 先移除帧回调，再冻结当前帧；StopTimeline 的终态回调不能清掉按下姿态。
        var frame = _motion.Frame;
        _holding = true; SoftClayMotion.StopTimeline(this); _holding = false;
        _motion.Hold(); ApplyFrame(frame);
    }
    private bool _holding;
    internal void Release() { if (!_motion.Held) return; _motion.Release(); Wake(); }
    internal void Leave() { _motion.Leave(); Wake(); }
    private void StopAndReset() { SoftClayMotion.StopTimeline(this); _motion.Reset(); ApplyFrame(_motion.Frame); }
    private void Wake()
    {
        if (!_ready || _reduced) { StopAndReset(); return; }
        SoftClayMotion.Animate(this, elapsed =>
        {
            if (_holding) return false;
            var moving = _motion.Step(elapsed); ApplyFrame(_motion.Frame); return moving;
        });
    }
    internal void ApplyFrame(BackdropFrame frame)
    {
        _shift.X = frame.X; _shift.Y = frame.Y;
        _lightShift.X = frame.LightX; _lightShift.Y = frame.LightY;
        _atmosphere.Opacity = _ready && (_entered || _reduced) ? frame.Entry : 0;
    }
    protected override void OnRenderSizeChanged(SizeChangedInfo sizeInfo)
    {
        base.OnRenderSizeChanged(sizeInfo); StopAndReset(); Rebuild();
    }
    // 只在原图/布局变更时重建九片绘图；每帧仅变更两个 TranslateTransform。
    private void Rebuild()
    {
        var w = ActualWidth; var h = ActualHeight; var p = BackdropMotion.Padding;
        using (var drawing = _plane.Open())
        {
            if (Source is not null && w > 0 && h > 0)
            {
                drawing.DrawImage(Source, new Rect(0, 0, w, h));
                var destinations = new[] { new Rect(0, -p, w, p), new Rect(0, h, w, p), new Rect(-p, 0, p, h), new Rect(w, 0, p, h),
                    new Rect(-p, -p, p, p), new Rect(w, -p, p, p), new Rect(-p, h, p, p), new Rect(w, h, p, p) };
                for (var i = 0; i < _edges.Length; i++) drawing.DrawImage(_edges[i], destinations[i]);
            }
        }
        using (var drawing = _atmosphere.Open())
        {
            if (Source is not null && w > 0 && h > 0)
            {
                var brush = new RadialGradientBrush { Center = new Point(.47, .42), GradientOrigin = new Point(.47, .42), RadiusX = .7, RadiusY = .7 };
                brush.GradientStops.Add(new GradientStop(Color.FromArgb(0, 38, 30, 22), .24));
                brush.GradientStops.Add(new GradientStop(Color.FromArgb(25, 38, 30, 22), .65));
                brush.GradientStops.Add(new GradientStop(Color.FromArgb(56, 33, 26, 22), 1)); brush.Freeze();
                drawing.DrawRectangle(brush, null, new Rect(-w * .2, -h * .2, w * 1.4, h * 1.4));
            }
        }
        InvalidateVisual();
    }
    protected override void OnRender(DrawingContext drawingContext) { base.OnRender(drawingContext); drawingContext.DrawDrawing(_scene); }
}
