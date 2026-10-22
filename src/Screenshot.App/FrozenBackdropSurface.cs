using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Screenshot.App;

/// <summary>冻结桌面的标准图片层；布局由 WPF 管理，隐藏时换图也不会留下空绘图。</summary>
public sealed class FrozenBackdropSurface : Grid
{
    private readonly Grid _plane = new();
    private readonly Border _atmosphere = new();
    private readonly MatrixTransform[] _edgeMask = new MatrixTransform[4];
    private readonly Image[] _tiles = new Image[9];
    private readonly TranslateTransform _shift = new(), _lightShift = new();
    private readonly BackdropMotion _motion = new();
    private readonly Func<double, bool> _advance;
    private BitmapSource? _source;
    private bool _ready, _allowed, _reduced, _entered, _animating, _holding;

    // WebView 与底图引用同一变换；无需跨进程逐帧消息，也不会出现内外相位差。
    internal TranslateTransform MotionTransform => _shift;
    public BitmapSource? Source
    {
        get => _source;
        set
        {
            if (ReferenceEquals(value, _source)) return;
            Suspend(); _source = value; _entered = false;
            foreach (var tile in _tiles) tile.Source = null;
            if (value is null) return;
            var w = value.PixelWidth; var h = value.PixelHeight;
            var rectangles = new[] { new Int32Rect(0, 0, 1, 1), new Int32Rect(0, 0, w, 1), new Int32Rect(w - 1, 0, 1, 1),
                new Int32Rect(0, 0, 1, h), new Int32Rect(0, 0, w, h), new Int32Rect(w - 1, 0, 1, h),
                new Int32Rect(0, h - 1, 1, 1), new Int32Rect(0, h - 1, w, 1), new Int32Rect(w - 1, h - 1, 1, 1) };
            for (var i = 0; i < _tiles.Length; i++)
            {
                if (i == 4) { _tiles[i].Source = value; continue; }
                var edge = new CroppedBitmap(value, rectangles[i]); edge.Freeze(); _tiles[i].Source = edge;
            }
        }
    }

    public FrozenBackdropSurface()
    {
        IsHitTestVisible = false; ClipToBounds = true; _advance = Advance;
        // 双线性采样保留亚像素位移；最近邻会把微动变成逐像素台阶。
        RenderOptions.SetBitmapScalingMode(this, BitmapScalingMode.LowQuality);
        var padding = BackdropMotion.Padding;
        _plane.Margin = new Thickness(-padding); _plane.RenderTransform = _shift;
        foreach (var size in new[] { new GridLength(padding), new GridLength(1, GridUnitType.Star), new GridLength(padding) })
        {
            _plane.RowDefinitions.Add(new RowDefinition { Height = size });
            _plane.ColumnDefinitions.Add(new ColumnDefinition { Width = size });
        }
        // 九片只引用原冻结图及其边缘；没有逐帧编码、整图复制或尺寸重建。
        for (var i = 0; i < _tiles.Length; i++)
        {
            var tile = _tiles[i] = new Image { Stretch = Stretch.Fill };
            SetRow(tile, i / 3); SetColumn(tile, i % 3); _plane.Children.Add(tile);
        }
        var brush = new RadialGradientBrush { Center = new Point(.47, .42), GradientOrigin = new Point(.47, .42), RadiusX = .7, RadiusY = .7 };
        brush.GradientStops.Add(new GradientStop(Color.FromArgb(0, 38, 30, 22), .24));
        brush.GradientStops.Add(new GradientStop(Color.FromArgb(25, 38, 30, 22), .65));
        brush.GradientStops.Add(new GradientStop(Color.FromArgb(56, 33, 26, 22), 1)); brush.Freeze();
        _atmosphere.Background = brush; _atmosphere.Margin = new Thickness(-padding);
        _atmosphere.RenderTransform = _lightShift; _atmosphere.Opacity = 0;
        Children.Add(_plane); Children.Add(_atmosphere);
        // WebView 整体轻移后，视口边缘露出的细条继续使用同一遮罩，避免出现亮边。
        var maskBrush = new SolidColorBrush(SoftClayTheme.Color("mask")); maskBrush.Freeze();
        for (var i = 0; i < _edgeMask.Length; i++)
        {
            var strip = new Border { Background = maskBrush, RenderTransform = _edgeMask[i] = new MatrixTransform(new Matrix(0, 0, 0, 0, 0, 0)) };
            if (i < 2) { strip.Width = 1; strip.HorizontalAlignment = HorizontalAlignment.Left; }
            else { strip.Height = 1; strip.VerticalAlignment = VerticalAlignment.Top; }
            Children.Add(strip);
        }
        IsVisibleChanged += (_, _) => { if (!IsVisible) Suspend(); };
        Unloaded += (_, _) => Suspend();
        SizeChanged += (_, _) => StopAndReset();
    }

    // 就绪门之前不位移、不加暗角，首次交接仍使用原始像素对齐。
    internal void SetPolicy(bool ready, bool allowed, bool reduced)
    {
        _ready = ready && Source is not null; _allowed = allowed; _reduced = reduced;
        if (!_ready || reduced) { StopAndReset(); return; }
        if (allowed && !_entered) { _entered = true; _motion.Enter(); }
        if (!allowed && !_motion.Held) _motion.Center();
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
        if (!_ready || _reduced) return;
        // 转发按下给编辑器之前冻结共用变换，整段手势的指针与画布映射不漂移。
        _holding = true; SoftClayMotion.StopTimeline(this); _holding = false; _animating = false;
        _motion.Hold(); ApplyFrame(_motion.Frame);
    }
    internal void Release() { if (!_motion.Held) return; _motion.Release(); if (!_allowed) _motion.Center(); Wake(); }
    internal void Leave() { _motion.Leave(); Wake(); }
    private void StopAndReset() { SoftClayMotion.StopTimeline(this); _animating = false; _motion.Reset(); ApplyFrame(_motion.Frame); }
    private void Wake()
    {
        if (!_ready || _reduced) { StopAndReset(); return; }
        if (_animating || _motion.Held) return;
        // 高频鼠标输入只改目标；停稳后才重新加入已有的合成帧订阅。
        _animating = true; SoftClayMotion.Animate(this, _advance);
    }
    private bool Advance(double elapsed)
    {
        if (_holding) return false;
        var moving = _motion.Step(elapsed); ApplyFrame(_motion.Frame); _animating = moving; return moving;
    }
    internal void ApplyFrame(BackdropFrame frame)
    {
        _shift.X = frame.X; _shift.Y = frame.Y;
        _lightShift.X = frame.LightX; _lightShift.Y = frame.LightY;
        _atmosphere.Opacity = _ready && (_entered || _reduced) && Source is not null ? frame.Entry : 0;
        var w = ActualWidth; var h = ActualHeight;
        var x = Math.Clamp(frame.X, -w, w); var y = Math.Clamp(frame.Y, -h, h);
        // 固定尺寸细条只改变换，不逐帧触发布局；竖条避开横条，四角不叠加变黑。
        var vertical = h > 0 ? (h - Math.Abs(y)) / h : 0;
        _edgeMask[0].Matrix = new Matrix(Math.Max(0, x), 0, 0, vertical, 0, Math.Max(0, y));
        _edgeMask[1].Matrix = new Matrix(Math.Max(0, -x), 0, 0, vertical, w + Math.Min(0, x), Math.Max(0, y));
        _edgeMask[2].Matrix = new Matrix(1, 0, 0, Math.Max(0, y), 0, 0);
        _edgeMask[3].Matrix = new Matrix(1, 0, 0, Math.Max(0, -y), 0, h + Math.Min(0, y));
    }
}
