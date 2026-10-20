using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App;

// 仅在用户显式捕获时读取显示器与指定 HWND，不枚举窗口或弹出系统选择器。
internal sealed class WindowsCapturePlatform : ICapturePlatform
{
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; public PixelRect Pixels => new(Left, Top, Right - Left, Bottom - Top); }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    private delegate bool MonitorCallback(nint monitor, nint dc, nint bounds, nint data);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumDisplayMonitors(nint dc, nint clip, MonitorCallback callback, nint data);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(nint window, out Rect bounds);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetClientRect(nint window, out Rect bounds);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ClientToScreen(nint window, ref Point origin);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint window, int attribute, out Rect bounds, int size);

    // 仅捕获请求执行时读取显示器的实际物理边界，构造平台对象不执行此调用。
    public IReadOnlyList<CaptureMonitor> GetMonitors()
    {
        var result = new List<CaptureMonitor>();
        if (!EnumDisplayMonitors(0, 0, (monitor, _, _, _) =>
        {
            var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (GetMonitorInfo(monitor, ref info)) result.Add(new(monitor, info.Monitor.Pixels, (info.Flags & 1) != 0, info.Work.Pixels));
            return true;
        }, 0)) throw new CaptureException("capture_target_unavailable", "无法读取显示器物理边界。");
        return result;
    }

    // 标题栏窗口使用 DWM 可见边界；客户区使用真实 ClientToScreen 原点，不猜测边框厚度。
    public PixelRect GetWindowBounds(nint handle, bool clientArea)
    {
        if (!IsWindow(handle) || !IsWindowVisible(handle) || IsIconic(handle))
            throw new CaptureException("capture_target_unavailable", "窗口不存在、不可见或已最小化。");
        if (clientArea)
        {
            if (!GetClientRect(handle, out var client)) throw new CaptureException("capture_target_unavailable", "无法读取窗口客户区。");
            var origin = new Point();
            if (!ClientToScreen(handle, ref origin)) throw new CaptureException("capture_target_unavailable", "无法定位窗口客户区。");
            return new(origin.X, origin.Y, client.Right - client.Left, client.Bottom - client.Top);
        }
        if (DwmGetWindowAttribute(handle, 9, out var visible, Marshal.SizeOf<Rect>()) >= 0) return visible.Pixels;
        if (GetWindowRect(handle, out var outer)) return outer.Pixels;
        throw new CaptureException("capture_target_unavailable", "无法读取窗口物理边界。");
    }

    // 自由线程帧池和 GPU→CPU 深拷贝在后台执行；错误只映射类别，绝不退回 GDI。
    public Task<CapturePixels> CaptureItemAsync(CaptureTargetKind kind, nint handle, int timeoutMs, CancellationToken token) => Task.Run(async () =>
    {
        token.ThrowIfCancellationRequested();
        try
        {
            return await CaptureFrameReader.ReadAsync(new WgcFrameSession(kind, handle), TimeSpan.FromMilliseconds(timeoutMs), token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception)
        {
            var mapped = CaptureErrors.Map(exception);
            if (mapped is not null) throw mapped;
            throw;
        }
    }, token);
}
