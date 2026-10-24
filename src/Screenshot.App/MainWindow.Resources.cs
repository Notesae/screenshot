using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace Screenshot.App;

public partial class MainWindow
{
    private readonly DispatcherTimer _resourceIdle = new(DispatcherPriority.Background) { Interval = TimeSpan.FromMinutes(2) };
    private bool _lowMemoryTarget, _memoryTargetUnavailable;

    // 只在隐藏且持续空闲时收缩可重建资源；网页脚本、内存文档、历史及共享动效时钟保持存活。
    private void InitializeResourcePolicy()
    {
        _resourceIdle.Tick += ReleaseIdleResources;
        IsVisibleChanged += (_, _) => { if (IsVisible) WakeEditorResources(); else ScheduleIdleResources(); };
        Closed += (_, _) => _resourceIdle.Stop();
    }

    private void WakeEditorResources()
    {
        _resourceIdle.Stop();
        if (!_lifetime.IsCancellationRequested) SetMemoryTarget(low: false);
    }
    private void ScheduleIdleResources()
    {
        if (IsVisible || _lifetime.IsCancellationRequested) return;
        _resourceIdle.Stop(); _resourceIdle.Start();
    }

    // 不使用脚本挂起或进程工作集裁剪；显示、跨桥消息和离开检查前先恢复普通内存目标。
    private void SetMemoryTarget(bool low)
    {
        if (_memoryTargetUnavailable || _lowMemoryTarget == low) return;
        try
        {
            if (Editor.CoreWebView2 is not { } core) return;
            core.MemoryUsageTargetLevel = low ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
            _lowMemoryTarget = low;
        }
        catch (Exception error) when (error is NotImplementedException or COMException or InvalidOperationException)
        {
            // 较旧或已退出的运行库可不支持此可选提示，不影响原有编辑和重载路径。
            _memoryTargetUnavailable = true;
        }
    }

    private async void ReleaseIdleResources(object? sender, EventArgs args)
    {
        _resourceIdle.Stop();
        if (IsVisible || _lifetime.IsCancellationRequested) return;
        if (_startingInTray || _preserving || _requests.IsBusy) { ScheduleIdleResources(); return; }
        SetMemoryTarget(low: true);
        try { await Task.Run(_localOcr.ReleaseIdleSessions, _lifetime.Token); }
        // 空闲收缩是尽力操作；退出或原生释放失败不弹出窗口，也不终止编辑器。
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested) { }
        catch (Exception error) { Trace.TraceWarning("空闲 OCR 会话释放失败：" + error.GetType().Name); }
    }
}
