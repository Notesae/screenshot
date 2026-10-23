using System;

namespace Screenshot.App;

/// <summary>软边向精确选区外延展的 DIP 数据；半径、鼓起和透明度来自同一份惯性。</summary>
internal readonly record struct CaptureRim(double Left, double Top, double Right, double Bottom, double Radius, double Bend, double Energy);

/// <summary>首次框选的纯视觉状态：输入为 DIP，绝不持有选区或改写截图坐标。</summary>
internal sealed class CaptureMotion
{
    // 胶囊与控制点沿用既有反馈；四条软边和显现脉冲单独使用柔软的选区弹簧。
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _birth = new(1), _pulse = new();
    private readonly SoftClayMotion.SpringState[] _edges = [new(), new(), new(), new()];
    private double _anchorX, _anchorY, _width, _height;
    private bool _visible;
    public double OffsetX => Math.Clamp(_x.Value, -5, 5);
    public double OffsetY => Math.Clamp(_y.Value, -4, 4);
    public double HandleScale => Math.Clamp(_birth.Value, .72, 1.06);
    public bool Moving => _x.Moving || _y.Moving || _birth.Moving || _pulse.Moving || _edges[0].Moving || _edges[1].Moving || _edges[2].Moving || _edges[3].Moving;

    /// <summary>软边始终包住精确矩形；小选区按边长限制惯性和圆角，不让胶边吞掉选区。</summary>
    public CaptureRim Rim
    {
        get
        {
            var tokens = SoftClayMotion.SelectionTokens;
            var maximum = 0d;
            foreach (var edge in _edges) maximum = Math.Max(maximum, Math.Abs(edge.Value));
            var energy = Math.Clamp(maximum / tokens.GetProperty("maxLag").GetDouble() + Math.Abs(_pulse.Value), 0, 1);
            var radius = Math.Min(tokens.GetProperty("radius").GetDouble(), Math.Min(_width, _height) * .14) * energy;
            var pad = radius * .4;
            return new(pad + Math.Max(0, -_edges[0].Value), pad + Math.Max(0, -_edges[1].Value),
                pad + Math.Max(0, _edges[2].Value), pad + Math.Max(0, _edges[3].Value), radius, tokens.GetProperty("bend").GetDouble() * energy, energy);
        }
    }

    /// <summary>读数立即改变；只把边界差积入软边，保留既有速度和物理像素选区。</summary>
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
                    _edges[index].Value = Math.Clamp(_edges[index].Value + delta[index] * tokens.GetProperty("gain").GetDouble(), -limit, limit);
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
