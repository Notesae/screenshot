namespace Screenshot.App;

/// <summary>首次框选的纯视觉状态：输入为 DIP，绝不持有选区或改写截图坐标。</summary>
internal sealed class CaptureMotion
{
    // 胶囊短惯性与控制点体积共用原生 v2 求解器，不为冻结帧另起算法。
    private readonly SoftClayMotion.SpringState _x = new(), _y = new(), _birth = new(1);
    private double _anchorX, _anchorY;
    private bool _visible;
    public double OffsetX => System.Math.Clamp(_x.Value, -5, 5);
    public double OffsetY => System.Math.Clamp(_y.Value, -4, 4);
    public double HandleScale => System.Math.Clamp(_birth.Value, .72, 1.06);
    public bool Moving => _x.Moving || _y.Moving || _birth.Moving;

    /// <summary>目标读数立即改变；只将前后锚点差积入有界装饰偏移。</summary>
    public void Update(double x, double y, bool visible, bool reduced)
    {
        if (!visible) { _visible = false; Snap(); return; }
        if (reduced) Snap();
        else if (!_visible) { _birth.Snap(.72); _birth.To = 1; }
        else
        {
            _x.Value = System.Math.Clamp(_x.Value + _anchorX - x, -5, 5);
            _y.Value = System.Math.Clamp(_y.Value + _anchorY - y, -4, 4);
        }
        _anchorX = x; _anchorY = y; _visible = true;
    }

    /// <summary>有界步长与停稳阈值和按钮一致，停稳后调用方停止计时器。</summary>
    public bool Step(double elapsed)
    {
        var moving = _x.Step(elapsed, "neighbor");
        moving = _y.Step(elapsed, "neighbor") || moving;
        return _birth.Step(elapsed, "entry") || moving;
    }

    // 交接和减少动态时同步归位，不能把未完成的装饰状态带入 WebView 首帧。
    public void Snap() { _x.Snap(0); _y.Snap(0); _birth.Snap(1); }
}
