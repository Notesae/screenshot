using System;
using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;

namespace Screenshot.App;

public partial class MainWindow
{
    private readonly BackdropMotionGate _backdropGate = new();
    private bool _backdropAdjusting;

    // CompositionControl 的路由输入在当前窗口内处理；不读取全局指针、不增加原生钩子。
    private void InitializeBackdropMotion()
    {
        AddHandler(PreviewMouseMoveEvent, new MouseEventHandler((_, e) =>
        {
            if (e.StylusDevice is null) FrozenBackdrop.Move(e.GetPosition(FrozenBackdrop));
        }), true);
        AddHandler(PreviewMouseDownEvent, new MouseButtonEventHandler((_, _) => FrozenBackdrop.Hold()), true);
        AddHandler(PreviewMouseUpEvent, new MouseButtonEventHandler((_, _) => FrozenBackdrop.Release()), true);
        AddHandler(LostMouseCaptureEvent, new MouseEventHandler((_, _) => FrozenBackdrop.Release()), true);
        MouseLeave += (_, _) => FrozenBackdrop.Leave();
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
        var ready = IsVisible && IsActive && !_backdropAdjusting && !_presentation.IsSelecting
            && _presentation.Mode == PresentationMode.Overlay && _presentation.PendingCaptureId is null;
        FrozenBackdrop.SetPolicy(ready, _backdropGate.Enabled, !SystemParameters.ClientAreaAnimation || Environment.ProcessorCount <= 2);
    }
    private object UpdateBackdropMotion(JsonElement payload)
    {
        var captureId = RequiredString(payload, "captureId");
        var sequence = payload.GetProperty("sequence").GetInt64(); var enabled = payload.GetProperty("enabled").GetBoolean();
        // 重新框选时仍记住旧文档的最新许可；实际运动由 ready 门关闭，取消后不会丢掉恢复消息。
        var accepted = _presentation.Mode == PresentationMode.Overlay && _presentation.PendingCaptureId is null
            && _presentation.Overlay?.CaptureId == captureId && _backdropGate.Apply(captureId, sequence, enabled);
        if (accepted) RefreshBackdropMotion();
        return new { accepted };
    }
}
