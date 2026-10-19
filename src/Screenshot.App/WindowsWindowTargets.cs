using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Screenshot.App;
internal static class WindowsWindowTargets
{
    private delegate bool WindowCallback(nint window,nint data);
    [DllImport("user32.dll")]private static extern bool EnumWindows(WindowCallback callback,nint data);
    [DllImport("user32.dll")]private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")]private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(nint window,out uint process);
    [DllImport("dwmapi.dll")]private static extern int DwmGetWindowAttribute(nint window,int attribute,out int value,int size);
    // 仅用户发起区域捕获后创建一次有限几何快照；不在启动/状态读取时枚举窗口。
    internal static IReadOnlyList<WindowSnapTarget> Snapshot()
    {
        var result=new List<WindowSnapTarget>();var platform=new WindowsCapturePlatform();
        if(!EnumWindows((window,_)=>{
            if(result.Count>=256)return true;
            GetWindowThreadProcessId(window,out var process);
            if(process==(uint)Environment.ProcessId||!IsWindowVisible(window)||IsIconic(window))return true;
            if(DwmGetWindowAttribute(window,14,out var cloaked,sizeof(int))>=0&&cloaked!=0)return true;
            try{var bounds=platform.GetWindowBounds(window,false);var client=platform.GetWindowBounds(window,true);if(bounds.Width>=2&&bounds.Height>=2)result.Add(new(window,bounds,client));}catch(CaptureException){/* 枚举期间关闭的窗口不进入快照。 */}
            return true;
        },0))throw new CaptureException("capture_target_unavailable","无法读取窗口吸附范围，请关闭吸附后重试。");
        return result;
    }
}
