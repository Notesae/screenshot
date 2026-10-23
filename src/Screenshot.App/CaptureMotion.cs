using System;

namespace Screenshot.App;

/// <summary>边框本体的有符号 DIP 偏移和各边曲率；不再代表外圈装饰或透明度。</summary>
internal readonly record struct CaptureBorderFrame(double Left, double Top, double Right, double Bottom, double Radius,
    double BendLeft, double BendTop, double BendRight, double BendBottom);

/// <summary>首次框选的纯视觉状态：输入为 DIP，绝不持有选区或改写截图坐标。</summary>
internal sealed class CaptureMotion
{
    // 胶囊保留既有反馈，四条边的真实描线与显现呼吸使用同一组弹簧。
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _birth = new(1), _pulse = new();
    private readonly SoftClayMotion.SpringState[] _edges = [new(), new(), new(), new()];
    private double _anchorX, _anchorY, _width, _height;
    private bool _visible;
    public double OffsetX => Math.Clamp(_x.Value, -5, 5);
    public double OffsetY => Math.Clamp(_y.Value, -4, 4);
    public double HandleScale => Math.Clamp(_birth.Value, .72, 1.06);
    public bool Moving => _x.Moving || _y.Moving || _birth.Moving || _pulse.Moving || _edges[0].Moving || _edges[1].Moving || _edges[2].Moving || _edges[3].Moving;

    /// <summary>有符号边缘直接移动边框；四边曲率、角和控制点最终使用同一轮廓。</summary>
    public CaptureBorderFrame Border
    {
        get
        {
            var tokens = SoftClayMotion.SelectionTokens;
            // 输出也按当前边长钳制，避免缩小过程中残留速度让相对边交叉。
            var limit = Math.Min(tokens.GetProperty("maxLag").GetDouble(), Math.Min(_width, _height) * .12);
            var edges = Array.ConvertAll(_edges, edge => Math.Clamp(edge.Value, -limit, limit));
            var maximum = 0d;
            foreach (var edge in edges) maximum = Math.Max(maximum, Math.Abs(edge));
            var energy = Math.Clamp(maximum / tokens.GetProperty("maxLag").GetDouble() + Math.Abs(_pulse.Value), 0, 1);
            var breath = _pulse.Value * Math.Min(tokens.GetProperty("bend").GetDouble(), Math.Min(_width, _height) * .12);
            var left = edges[0] - breath; var top = edges[1] - breath;
            var right = edges[2] + breath; var bottom = edges[3] + breath;
            var radius = Math.Min(tokens.GetProperty("radius").GetDouble(), Math.Min(_width + right - left, _height + bottom - top) * .18) * energy;
            return new(left, top, right, bottom, radius, edges[0] * .35 - breath * .5, edges[1] * .35 - breath * .5,
                edges[2] * .35 + breath * .5, edges[3] * .35 + breath * .5);
        }
    }

    /// <summary>逻辑边界立即改变；前缘跟手、后缘拖长，显示边缘保留原速度。</summary>
    public void Update(double x, double y, bool visible, bool reduced, double width = 0, double height = 0)
    {
        if (!visible) { _visible = false; Snap(); return; }
        if (reduced) Snap();
        else if (!_visible)
        {
            _birth.Snap(.72); _birth.To = 1;
            if (width > 0 && height > 0) { _pulse.Snap(SoftClayMotion.SelectionTokens.GetProperty("pulse").GetDouble()); _pulse.To = 0; }
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
            }
        }
        _anchorX = x; _anchorY = y; _width = width; _height = height; _visible = true;
    }

    /// <summary>胶边与胶囊复用原生有界求解器，全部落定后停止已有计时器。</summary>
    public bool Step(double elapsed)
    {
        var moving = _x.Step(elapsed, "neighbor");
        moving = _y.Step(elapsed, "neighbor") || moving;
        moving = _birth.Step(elapsed, "entry") || moving;
        moving = _pulse.Step(elapsed, "selection") || moving;
        foreach (var edge in _edges) moving = edge.Step(elapsed, "selection") || moving;
        return moving;
    }

    // 系统减少动态或隐藏时同步归位；交接无需等待回弹，不改变精确范围。
    public void Snap()
    {
        _x.Snap(0); _y.Snap(0); _birth.Snap(1); _pulse.Snap(0);
        foreach (var edge in _edges) edge.Snap(0);
    }
}
