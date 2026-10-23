using System;

namespace Screenshot.App;

/// <summary>有符号边界、nw/ne/se/sw 圆角与顶点偏移；冻结图和手柄共用同一条受力轮廓。</summary>
internal readonly record struct CaptureBorderFrame(double Left, double Top, double Right, double Bottom, double[] Corners,
    double BendLeft, double BendTop, double BendRight, double BendBottom, double RippleX, double RippleY, double[] OffsetX, double[] OffsetY);

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
    // 首次框选保留按下锚点和原始指针；两侧牵引与展开进度不参与业务坐标计算。
    private readonly SoftClayMotion.SpringState _formation = new(), _unfold = new(1), _pullX = new(), _pullY = new();
    private double _originX, _originY, _tipX, _tipY;
    private bool _creating;
    // 尚未拖出有效面积时仍显示边框本体的小软团，半径由按下入场进度决定。
    public double SeedSize => _creating && _dragging && !_visible
        ? SoftClayMotion.SelectionTokens.GetProperty("creation").GetProperty("seed").GetDouble() * 2 * Math.Clamp(_birth.Value, 0, 1) : 0;
    // nw/ne/se/sw 顺时针编号，取原始指针相对按下点的象限，不读取变形顶点。
    private int GripCorner => _tipY >= _originY ? (_tipX >= _originX ? 2 : 3) : (_tipX >= _originX ? 1 : 0);

    /// <summary>鼠标角先显现，两侧和起点角随后展开；松手后直接续接完整控制点。</summary>
    public double HandleReveal(int index)
    {
        if (!_creating) return HandleScale;
        var distance = Math.Abs(index - GripCorner * 2); distance = Math.Min(distance, 8 - distance);
        var delay = distance * .0875;
        var reveal = Math.Clamp((Math.Clamp(_unfold.Value + .25, 0, 1) - delay) / (1 - delay), 0, 1);
        var pin = Math.Clamp(_formation.Value, 0, 1);
        return HandleScale * (1 - pin + pin * reveal);
    }

    /// <summary>真正按下空白才从锚点生长；清掉窗口悬停轮廓，不增加截图确认或延迟。</summary>
    public void BeginFormation(double x, double y, bool reduced)
    {
        Snap();
        if (reduced) return;
        _originX = _tipX = x; _originY = _tipY = y; _creating = _dragging = true;
        _formation.Snap(1); _unfold.Snap(0);
        _birth.Snap(.22); _birth.To = 1;
        foreach (var corner in _corners) corner.Snap(.45);
    }

    // 完整受力链落定后才让已有计时器休眠，不创建额外计时器。
    public bool Moving
    {
        get
        {
            if (_formation.Moving || _unfold.Moving || _pullX.Moving || _pullY.Moving || _released || _x.Moving || _y.Moving || _birth.Moving || _pulse.Moving || _ripple[0].Moving || _ripple[1].Moving || _squash[0].Moving || _squash[1].Moving) return true;
            foreach (var edge in _edges) if (edge.Moving) return true;
            foreach (var corner in _corners) if (corner.Moving) return true;
            return false;
        }
    }

    /// <summary>成形时锁住起点和鼠标角，两侧角被牵开；所有顶点仍按真实边长限制形变。</summary>
    public CaptureBorderFrame Border
    {
        get
        {
            var tokens = SoftClayMotion.SelectionTokens;
            var creation = tokens.GetProperty("creation");
            var seed = SeedSize / 2;
            if (seed > 0) return new(0, 0, 0, 0, [seed, seed, seed, seed], 0, 0, 0, 0, 0, 0, new double[4], new double[4]);
            var side = Math.Min(_width, _height); var limit = Math.Min(tokens.GetProperty("maxLag").GetDouble(), side * .12);
            var edges = Array.ConvertAll(_edges, edge => Math.Clamp(edge.Value, -limit, limit));
            var breath = _pulse.Value * Math.Min(tokens.GetProperty("bend").GetDouble(), side * .12);
            var squashLimit = Math.Min(tokens.GetProperty("squash").GetDouble(), side * .05);
            var sx = Math.Clamp(_squash[0].Value, -squashLimit, squashLimit); var sy = Math.Clamp(_squash[1].Value, -squashLimit, squashLimit);
            var left = edges[0] - breath - sx; var top = edges[1] - breath - sy;
            var right = edges[2] + breath + sx; var bottom = edges[3] + breath + sy;
            var pin = _creating ? Math.Clamp(_formation.Value, 0, 1) : 0;
            var compact = 1 - Math.Clamp(side / creation.GetProperty("compactAt").GetDouble(), 0, 1);
            var radius = Math.Min(tokens.GetProperty("radius").GetDouble() * (1 - pin) + creation.GetProperty("radius").GetDouble() * pin,
                Math.Min(_width + right - left, _height + bottom - top) * (.18 + (creation.GetProperty("roundness").GetDouble() - .18) * compact * pin));
            var corners = Array.ConvertAll(_corners, corner => radius * Math.Clamp(corner.Value, 0, 1));
            var offsetX = new double[4]; var offsetY = new double[4];
            if (pin > 0)
            {
                var lag = creation.GetProperty("lag").GetDouble();
                var pullX = Math.Clamp(_pullX.Value, -lag, lag); var pullY = Math.Clamp(_pullY.Value, -lag, lag);
                var tension = Math.Clamp((Math.Abs(pullX) + Math.Abs(pullY)) / (lag * 2), 0, 1);
                var neck = Math.Min(creation.GetProperty("neck").GetDouble(), side * .16)
                    * (compact * .55 + (1 - Math.Clamp(_unfold.Value, 0, 1)) * .45 + tension * .35) * pin;
                var grip = GripCorner;
                // 顺时针索引的 ^2/^3/^1 分别是起点角、横向跟随角和纵向跟随角。
                for (var index = 0; index < 4; index++)
                {
                    var bx = index == 0 || index == 3 ? left : right; var by = index < 2 ? top : bottom;
                    var x = bx; var y = by;
                    if (index == (grip ^ 2)) { x *= 1 - pin; y *= 1 - pin; }
                    else if (index == grip)
                    {
                        x = bx * (1 - pin) - pullX * creation.GetProperty("gripLag").GetDouble() * pin;
                        y = by * (1 - pin) - pullY * creation.GetProperty("gripLag").GetDouble() * pin;
                    }
                    else if (index == (grip ^ 3)) { x -= pullX * creation.GetProperty("sideLag").GetDouble() * pin; y += (_tipY >= _originY ? 1 : -1) * neck; }
                    else { x += (_tipX >= _originX ? 1 : -1) * neck; y -= pullY * creation.GetProperty("sideLag").GetDouble() * pin; }
                    offsetX[index] = Math.Clamp(x, -Math.Min(lag, _width * .16), Math.Min(lag, _width * .16)) - bx;
                    offsetY[index] = Math.Clamp(y, -Math.Min(lag, _height * .16), Math.Min(lag, _height * .16)) - by;
                }
            }
            var waveLimit = Math.Min(tokens.GetProperty("ripple").GetDouble(), side * .05);
            return new(left, top, right, bottom, corners, edges[0] * .35 - breath * .5, edges[1] * .35 - breath * .5,
                edges[2] * .35 + breath * .5, edges[3] * .35 + breath * .5,
                Math.Clamp(_ripple[0].Value, -waveLimit, waveLimit), Math.Clamp(_ripple[1].Value, -waveLimit, waveLimit), offsetX, offsetY);
        }
    }

    /// <summary>逻辑边界立即改变；真实位移驱动惯性与切向波动，松手状态只排队一次冲量。</summary>
    public void Update(double x, double y, bool visible, bool reduced, double width = 0, double height = 0, bool dragging = false, double gripX = 0, double gripY = 0)
    {
        if (reduced) Snap();
        if (_creating)
        {
            var creation = SoftClayMotion.SelectionTokens.GetProperty("creation");
            var lag = creation.GetProperty("lag").GetDouble(); var gain = creation.GetProperty("gain").GetDouble();
            _pullX.Value = Math.Clamp(_pullX.Value + (gripX - _tipX) * gain, -lag, lag);
            _pullY.Value = Math.Clamp(_pullY.Value + (gripY - _tipY) * gain, -lag, lag);
            _tipX = gripX; _tipY = gripY; _formation.To = dragging ? 1 : 0;
            // 按住软团不会提前消耗展开；第一次有面积时才从真实牵引角开始显现。
            if (visible && !_visible && _unfold.Value == 0)
                for (var index = 0; index < _corners.Length; index++) _corners[index].Snap(index == GripCorner ? .85 : index == (GripCorner ^ 2) ? .3 : .55);
            _unfold.To = visible ? 1 : 0;
        }
        if (!visible)
        {
            _visible = false;
            if (_creating && dragging) { _width = _height = 0; foreach (var edge in _edges) edge.Snap(0); }
            else Snap();
            _dragging = dragging; return;
        }
        if (!reduced)
        {
            if (_dragging && !dragging) _released = true;
            if (dragging) _released = false;
            if (!_visible)
            {
                if (!_creating)
                {
                    _birth.Snap(.72); _birth.To = 1;
                    if (width > 0 && height > 0)
                    {
                        _pulse.Snap(SoftClayMotion.SelectionTokens.GetProperty("pulse").GetDouble()); _pulse.To = 0;
                        foreach (var corner in _corners) corner.Snap(_pulse.Value);
                    }
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

    /// <summary>推进既有回弹和接力，同时续接首次成形的两侧牵引与展开进度。</summary>
    public bool Step(double elapsed)
    {
        var tokens = SoftClayMotion.SelectionTokens;
        var maxLag = tokens.GetProperty("maxLag").GetDouble();
        if (_released)
        {
            var x = (Math.Abs(_edges[0].Value) + Math.Abs(_edges[2].Value)) / 2 + (_creating ? Math.Abs(_pullX.Value) * .3 : 0);
            var y = (Math.Abs(_edges[1].Value) + Math.Abs(_edges[3].Value)) / 2 + (_creating ? Math.Abs(_pullY.Value) * .3 : 0);
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
        _formation.Step(elapsed, "entry"); _unfold.Step(elapsed, "selectionCreate");
        _pullX.Step(elapsed, "selectionCreate"); _pullY.Step(elapsed, "selectionCreate");
        // 保存上一帧再统一设目标，避免数组求值顺序让一侧压力提前传播。
        var previous = Array.ConvertAll(_corners, corner => corner.Value);
        var carry = tokens.GetProperty("cornerCarry").GetDouble();
        var creation = tokens.GetProperty("creation");
        var compact = 1 - Math.Clamp(Math.Min(_width, _height) / creation.GetProperty("compactAt").GetDouble(), 0, 1);
        var hold = _creating ? Math.Clamp(_formation.Value, 0, 1) * (creation.GetProperty("held").GetDouble() + (1 - creation.GetProperty("held").GetDouble()) * compact) : 0;
        for (var index = 0; index < _corners.Length; index++)
        {
            var x = index == 0 || index == 3 ? 0 : 2; var y = index < 2 ? 1 : 3;
            var strain = (Math.Abs(_edges[x].Value) + Math.Abs(_edges[y].Value)) / (2 * maxLag) + Math.Abs(_pulse.Value)
                + (Math.Abs(_squash[0].Value) + Math.Abs(_squash[1].Value)) / (tokens.GetProperty("squash").GetDouble() * 4);
            strain += hold * (index == GripCorner ? 1 : index == (GripCorner ^ 2) ? .35 : .75);
            _corners[index].To = Math.Clamp(strain * (1 - carry) + previous[(index + 3) % 4] * carry, 0, 1);
            _corners[index].Step(elapsed, "selectionCorner");
        }
        // 与网页一致，接力残值在整个受力链休眠时精确归零。
        var moving = Moving;
        if (!moving && !(_creating && _dragging)) { foreach (var corner in _corners) corner.Snap(0); _creating = false; }
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
        _formation.Snap(0); _unfold.Snap(1); _pullX.Snap(0); _pullY.Snap(0);
        _visible = _creating = _dragging = _released = false;
    }
}
