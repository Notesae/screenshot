using System;
using System.Globalization;
using System.Linq;
using System.Windows.Interop;

namespace Screenshot.App;
public partial class MainWindow
{
    private PixelRect CaptureAnchor()
    {
        if(_presentation.Overlay is {} overlay)return overlay.Selection;
        var handle=new WindowInteropHelper(this).Handle;
        if(GetWindowRect(handle,out var bounds))return new(bounds.Left,bounds.Top,bounds.Right-bounds.Left,bounds.Bottom-bounds.Top);
        return new(0,0,0,0);
    }
    private object ReadCaptureMonitors()
    {
        var monitors=new WindowsCapturePlatform().GetMonitors();var current=CaptureTargets.Current(monitors,CaptureAnchor());
        return new{monitors=monitors.Select((m,index)=>new{handle=m.Handle.ToInt64().ToString(CultureInfo.InvariantCulture),bounds=m.Bounds,primary=m.Primary,current=m.Handle==current.Handle,label=$"显示器 {index+1} · {m.Bounds.Width}×{m.Bounds.Height}"}).ToArray()};
    }
    private CaptureRequest CurrentMonitorRequest()
    {
        var monitor=CaptureTargets.Current(new WindowsCapturePlatform().GetMonitors(),CaptureAnchor());
        return new(_captureBackend,new(CaptureTargetKind.Monitor,monitor.Handle),false);
    }
}
