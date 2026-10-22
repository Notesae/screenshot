using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Threading;

namespace Screenshot.App;

/// <summary>关闭保护先执行，材质退出完成后才真正结束窗口及模态调用。</summary>
public class SoftClayWindow : Window
{
    private readonly NativeCloseGate _close = new();
    private DispatcherTimer? _exitDeadline;
    private SoftClayPopupSurface? Surface => Content as SoftClayPopupSurface;

    public SoftClayWindow()
    {
        IsVisibleChanged += (_, _) => { if (!IsVisible && _close.Pending) CommitLater(_close.Version); };
    }
    protected override void OnClosing(CancelEventArgs e)
    {
        base.OnClosing(e);
        var surface = Surface;
        var decision = _close.Request(e.Cancel, IsVisible && surface?.IsLoaded == true && SystemParameters.ClientAreaAnimation
            && !Dispatcher.HasShutdownStarted, DialogResult);
        if (decision == NativeCloseDecision.Cancelled) { RestoreSurface(); return; }
        if (decision == NativeCloseDecision.Immediate) return;
        e.Cancel = true;
        if (decision == NativeCloseDecision.Hold || surface is null) return;
        surface.SetClosing(true);
        var version = _close.Version;
        // 合成帧暂停时也不能把模态关闭悬挂；只在退场期间保留一次有界兜底。
        _exitDeadline = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(220) };
        _exitDeadline.Tick += (_, _) => { StopDeadline(); SoftClayMotion.StopTimeline(surface); CommitLater(version); };
        _exitDeadline.Start();
        SoftClayMotion.ExitSurface(surface, NativeSurfaceTransition.WindowExitSeconds, 0, 1, () => CommitLater(version));
    }
    // Closing 取消会让 WPF 清空 DialogResult；下一轮必须恢复原来明确的 true/false。
    private void CommitLater(long version)
    {
        if (Dispatcher.HasShutdownStarted) return;
        Dispatcher.BeginInvoke(DispatcherPriority.Normal, new Action(() =>
        {
            if (!_close.TryCommit(version)) return;
            StopDeadline();
            if (_close.DialogResult is bool result) DialogResult = result;
            else Close();
        }));
    }
    /// <summary>用户显式再次打开设置时，取消尚未提交的退出并从当前表面恢复。</summary>
    public void ResumePresentation()
    {
        if (!_close.Pending || _close.Committing) return;
        _close.Cancel(); RestoreSurface();
    }
    private void RestoreSurface()
    {
        StopDeadline();
        Surface?.SetClosing(false);
        Surface?.Enter();
    }
    private void StopDeadline() { _exitDeadline?.Stop(); _exitDeadline = null; }
    protected override void OnClosed(EventArgs e)
    {
        _close.Cancel();
        StopDeadline();
        if (Surface is { } surface) SoftClayMotion.StopSurface(surface);
        base.OnClosed(e);
    }
}
