using System;
using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;

namespace Screenshot.App;

public partial class MainWindow
{
    private readonly BackdropMotionGate _backdropGate = new();
    private bool _backdropAdjusting;
    // 仅记录窗口内的真实鼠标位置，排除共享平面位移产生的坐标同步事件。
    private Point? _backdropPointerPosition;
    // 原生位置变化与已消费序号分开；进入工具后再回到同一点仍是新的有效移动。
    private long _backdropPointerSequence, _backdropFollowSequence;

    // 按下/松开仍由宿主冻结共用平面；跟随坐标只接受网页完成选区与覆盖工具命中判断后的输入。
    private void InitializeBackdropMotion()
    {
        Editor.RenderTransform = FrozenBackdrop.MotionTransform;
        // 与底图同步切换运动/停稳采样；停稳后截图、文字和工具一起恢复锐利显示。
        Editor.SetBinding(RenderOptions.BitmapScalingModeProperty, new Binding
        {
            Source = FrozenBackdrop, Path = new PropertyPath(RenderOptions.BitmapScalingModeProperty), Mode = BindingMode.OneWay
        });
        AddHandler(PreviewMouseMoveEvent, new MouseEventHandler((_, e) =>
        {
            if (e.StylusDevice is not null) return;
            var point = e.GetPosition(FrozenBackdrop);
            if (_backdropPointerPosition == point) return;
            _backdropPointerPosition = point; _backdropPointerSequence++;
        }), true);
        AddHandler(PreviewMouseDownEvent, new MouseButtonEventHandler((_, _) => FrozenBackdrop.Hold()), true);
        AddHandler(PreviewMouseUpEvent, new MouseButtonEventHandler((_, _) => FrozenBackdrop.Release()), true);
        AddHandler(LostMouseCaptureEvent, new MouseEventHandler((_, _) => FrozenBackdrop.Release()), true);
        Activated += (_, _) => RefreshBackdropMotion();
        Deactivated += (_, _) => FrozenBackdrop.Suspend();
        IsVisibleChanged += (_, _) => RefreshBackdropMotion();
        SystemParameters.StaticPropertyChanged += BackgroundSystemChanged;
        Closed += (_, _) => { SystemParameters.StaticPropertyChanged -= BackgroundSystemChanged; FrozenBackdrop.Suspend(); _backdropGate.Reset(null); };
    }
    private void BackgroundSystemChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName == nameof(SystemParameters.ClientAreaAnimation)) RefreshBackdropMotion();
    }
    private void RefreshBackdropMotion()
    {
        var ready = IsVisible && IsActive && !_presentation.IsSelecting
            && _presentation.Mode == PresentationMode.Overlay && _presentation.PendingCaptureId is null;
        FrozenBackdrop.SetPolicy(ready, _backdropGate.Enabled, !SystemParameters.ClientAreaAnimation || Environment.ProcessorCount <= 2,
            _backdropAdjusting || _backdropGate.Holding);
    }
    // 规范化指针仅影响显示弹簧；身份、序号、就绪与手势保持仍服从原有原生门控。
    private object UpdateBackdropMotion(JsonElement payload)
    {
        var captureId = RequiredString(payload, "captureId");
        var sequence = payload.GetProperty("sequence").GetInt64(); var enabled = payload.GetProperty("enabled").GetBoolean();
        var holding = payload.TryGetProperty("holding", out var hold) && hold.GetBoolean();
        // 网页只传选区内的归一化坐标，不传屏幕坐标、整屏图像或系统输入命令。
        Point? pointer = null;
        if (payload.TryGetProperty("pointer", out var position))
        {
            if (position.ValueKind != JsonValueKind.Object
                || !position.TryGetProperty("x", out var xValue) || xValue.ValueKind != JsonValueKind.Number || !xValue.TryGetDouble(out var x)
                || !position.TryGetProperty("y", out var yValue) || yValue.ValueKind != JsonValueKind.Number || !yValue.TryGetDouble(out var y)
                || !double.IsFinite(x) || !double.IsFinite(y) || x < -1 || x > 1 || y < -1 || y > 1)
                throw new InvalidOperationException("背景跟随坐标无效。");
            pointer = new Point(x, y);
        }
        var policyChanged = enabled != _backdropGate.Enabled || holding != _backdropGate.Holding;
        // 重新框选时仍记住旧文档的最新许可；实际运动由 ready 门关闭，取消后不会丢掉恢复消息。
        var accepted = _presentation.Mode == PresentationMode.Overlay && _presentation.PendingCaptureId is null
            && _presentation.Overlay?.CaptureId == captureId && _backdropGate.Apply(captureId, sequence, enabled, holding);
        if (accepted)
        {
            // 连续有效指针只改目标，不重复刷新策略、恢复入场或重挂合成帧订阅。
            if (pointer is null || policyChanged) RefreshBackdropMotion();
            if (enabled && !holding && pointer is { } point && _backdropFollowSequence != _backdropPointerSequence)
            {
                _backdropFollowSequence = _backdropPointerSequence; FrozenBackdrop.Move(point);
            }
        }
        return new { accepted };
    }
}
