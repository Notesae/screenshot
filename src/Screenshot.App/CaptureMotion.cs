using System;

namespace Screenshot.App;

/// <summary>有符号边界、nw/ne/se/sw 四角半径及切向波动；冻结图和手柄共用这份轮廓。</summary>
internal readonly record struct CaptureBorderFrame(double Left, double Top, double Right, double Bottom, double[] Corners,
    double BendLeft, double BendTop, double BendRight, double BendBottom, double RippleX, double RippleY);

/// <summary>原生框选的纯表现状态：接力圆角、表面波动和松手挤压均不改写物理像素选区。</summary>
internal sealed class CaptureMotion
{
    // 胶囊沿用原反馈，四条边与 nw/ne/se/sw 四角保留独立速度。
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _birth = new(1), _pulse = new();
    private readonly SoftClayMotion.SpringState[] _edges = [new(), new(), new(), new()], _corners = [new(), new(), new(), new()];
    // 切向波动和松手挤压分两轴续接，只有本次有效拖动松手才排队一次释放冲量。
    private readonly SoftClayMotion.SpringState[] _ripple = [new(), new()], _squash = [new(), new()];
    private double _anchorX, _anchorY, _width, _height;
    private bool _visible, _dragging, _released;
    public double OffsetX => Math.Clamp(_x.Value, -5, 5);
    public double OffsetY => Math.Clamp(_y.Value, -4, 4);
    public double HandleScale => Math.Clamp(_birth.Value, .72, 1.06);
    // 完整受力链落定后才让已有计时器休眠，不创建额外计时器。
    public bool Moving
    {
        get
        {
            if (_released || _x.Moving || _y.Moving || _birth.Moving || _pulse.Moving || _ripple[0].Moving || _ripple[1].Moving || _squash[0].Moving || _squash[1].Moving) return true;
            foreach (var edge in _edges) if (edge.Moving) return true;
            foreach (var corner in _corners) if (corner.Moving) return true;
            return false;
        }
    }

    /// <summary>按当前短边限幅；缩小时残留速度不能让曲线交叉，减少动态归为同一个准确矩形。</summary>
    public CaptureBorderFrame Border
    {
        get
        {
            var tokens = SoftClayMotion.SelectionTokens;
            var side = Math.Min(_width, _height); var limit = Math.Min(tokens.GetProperty("maxLag").GetDouble(), side * .12);
            var edges = Array.ConvertAll(_edges, edge => Math.Clamp(edge.Value, -limit, limit));
            var breath = _pulse.Value * Math.Min(tokens.GetProperty("bend").GetDouble(), side * .12);
            var squashLimit = Math.Min(tokens.GetProperty("squash").GetDouble(), side * .05);
            var sx = Math.Clamp(_squash[0].Value, -squashLimit, squashLimit); var sy = Math.Clamp(_squash[1].Value, -squashLimit, squashLimit);
            var left = edges[0] - breath - sx; var top = edges[1] - breath - sy;
            var right = edges[2] + breath + sx; var bottom = edges[3] + breath + sy;
            var radius = Math.Min(tokens.GetProperty("radius").GetDouble(), Math.Min(_width + right - left, _height + bottom - top) * .18);
            var corners = Array.ConvertAll(_corners, corner => radius * Math.Clamp(corner.Value, 0, 1));
            var waveLimit = Math.Min(tokens.GetProperty("ripple").GetDouble(), side * .05);
            return new(left, top, right, bottom, corners, edges[0] * .35 - breath * .5, edges[1] * .35 - breath * .5,
                edges[2] * .35 + breath * .5, edges[3] * .35 + breath * .5,
                Math.Clamp(_ripple[0].Value, -waveLimit, waveLimit), Math.Clamp(_ripple[1].Value, -waveLimit, waveLimit));
        }
    }

    /// <summary>逻辑边界立即改变；真实位移驱动惯性与切向波动，松手状态只排队一次冲量。</summary>
    public void Update(double x, double y, bool visible, bool reduced, double width = 0, double height = 0, bool dragging = false)
    {
        if (!visible) { _visible = false; Snap(); _dragging = dragging; return; }
        if (reduced) Snap();
        else
        {
            if (_dragging && !dragging) _released = true;
            if (dragging) _released = false;
            if (!_visible)
            {
                _birth.Snap(.72); _birth.To = 1;
                if (width > 0 && height > 0)
                {
                    _pulse.Snap(SoftClayMotion.SelectionTokens.GetProperty("pulse").GetDouble()); _pulse.To = 0;
                    foreach (var corner in _corners) corner.Snap(_pulse.Value);
                }
            }
            else
            {
                _x.Value = Math.Clamp(_x.Value + _anchorX - x, -5, 5);
                _y.Value = Math.Clamp(_y.Value + _anchorY - y, -4, 4);
                if (width > 0 && height > 0)
                {
                    var tokens = SoftClayMotion.SelectionTokens;
                    var limit = Math.Min(tokens.GetProperty("maxLag").GetDouble(), Math.Min(width, height) * .12);
                    var delta = new[] { _anchorX - x, _anchorY - y, _anchorX + _width - x - width, _anchorY + _height - y - height };
                    for (var index = 0; index < _edges.Length; index++)
                    {
                        var trailing = index < 2 ? delta[index] < 0 : delta[index] > 0;
                        var gain = tokens.GetProperty("gain").GetDouble() * (trailing ? 1 : tokens.GetProperty("leading").GetDouble());
                        _edges[index].Value = Math.Clamp(_edges[index].Value + delta[index] * gain, -limit, limit);
                    }
                    var displacement = new[] { x + width / 2 - _anchorX - _width / 2, y + height / 2 - _anchorY - _height / 2 };
                    var ripple = tokens.GetProperty("ripple").GetDouble();
                    for (var index = 0; index < _ripple.Length; index++)
                        _ripple[index].Value = Math.Clamp(_ripple[index].Value + displacement[index] * tokens.GetProperty("rippleGain").GetDouble(), -ripple, ripple);
                }
            }
        }
        _anchorX = x; _anchorY = y; _width = width; _height = height; _visible = true; _dragging = dragging;
    }

    /// <summary>先释放一次挤压，再向相邻角传递上一帧压力，和网页采用相同的推进顺序。</summary>
    public bool Step(double elapsed)
    {
        var tokens = SoftClayMotion.SelectionTokens;
        var maxLag = tokens.GetProperty("maxLag").GetDouble();
        if (_released)
        {
            var x = (Math.Abs(_edges[0].Value) + Math.Abs(_edges[2].Value)) / 2;
            var y = (Math.Abs(_edges[1].Value) + Math.Abs(_edges[3].Value)) / 2;
            var impulse = tokens.GetProperty("releaseImpulse").GetDouble();
            var force = Math.Clamp((x + y) / maxLag, 0, 1) * impulse; var sum = x + y > 0 ? x + y : 1;
            _squash[0].Velocity = Math.Clamp(_squash[0].Velocity + (y * .6 - x) / sum * force, -impulse, impulse);
            _squash[1].Velocity = Math.Clamp(_squash[1].Velocity + (x * .6 - y) / sum * force, -impulse, impulse);
            _released = false;
        }
        _x.Step(elapsed, "neighbor"); _y.Step(elapsed, "neighbor"); _birth.Step(elapsed, "entry"); _pulse.Step(elapsed, "selection");
        foreach (var edge in _edges) edge.Step(elapsed, "selection");
        foreach (var wave in _ripple) wave.Step(elapsed, "selectionRipple");
        foreach (var mass in _squash) mass.Step(elapsed, "selectionRelease");
        // 保存上一帧再统一设目标，避免数组求值顺序让一侧压力提前传播。
        var previous = Array.ConvertAll(_corners, corner => corner.Value);
        var carry = tokens.GetProperty("cornerCarry").GetDouble();
        for (var index = 0; index < _corners.Length; index++)
        {
            var x = index == 0 || index == 3 ? 0 : 2; var y = index < 2 ? 1 : 3;
            var strain = (Math.Abs(_edges[x].Value) + Math.Abs(_edges[y].Value)) / (2 * maxLag) + Math.Abs(_pulse.Value)
                + (Math.Abs(_squash[0].Value) + Math.Abs(_squash[1].Value)) / (tokens.GetProperty("squash").GetDouble() * 4);
            _corners[index].To = Math.Clamp(strain * (1 - carry) + previous[(index + 3) % 4] * carry, 0, 1);
            _corners[index].Step(elapsed, "selectionCorner");
        }
        // 与网页一致，接力残值在整个受力链休眠时精确归零。
        var moving = Moving;
        if (!moving) foreach (var corner in _corners) corner.Snap(0);
        return moving;
    }

    /// <summary>系统减少动态或隐藏时清掉整条受力链，旧松手冲量不能带入下一次会话。</summary>
    public void Snap()
    {
        _x.Snap(0); _y.Snap(0); _birth.Snap(1); _pulse.Snap(0);
        foreach (var edge in _edges) edge.Snap(0);
        foreach (var corner in _corners) corner.Snap(0);
        foreach (var wave in _ripple) wave.Snap(0);
        foreach (var mass in _squash) mass.Snap(0);
        _dragging = _released = false;
    }
}
