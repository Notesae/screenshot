using System;
using System.Collections.Generic;
using System.Linq;

namespace Screenshot.App;

// 吸附仅保留窗口身份和物理边界，不读取标题、进程名或窗口内容。
internal sealed record WindowSnapTarget(nint Handle,PixelRect Bounds,PixelRect ClientBounds);
internal static class CaptureTargets
{
    internal static PixelRect Intersect(PixelRect a,PixelRect b)
    {
        var x=Math.Max(a.X,b.X);var y=Math.Max(a.Y,b.Y);var r=Math.Min((long)a.X+a.Width,(long)b.X+b.Width);var bottom=Math.Min((long)a.Y+a.Height,(long)b.Y+b.Height);
        return new(x,y,(int)Math.Max(0,r-x),(int)Math.Max(0,bottom-y));
    }
    // 列表保留本次快照的顶层窗口顺序；前方窗口覆盖客户区时不穿透去选后方窗口。
    internal static WindowSnapTarget? AtPoint(IReadOnlyList<WindowSnapTarget> targets,int x,int y,PixelRect allowed,bool client)
    {
        foreach(var target in targets)
        {
            var b=target.Bounds;if(x<b.X||y<b.Y||x>=(long)b.X+b.Width||y>=(long)b.Y+b.Height)continue;
            var clipped=Area(target,allowed,client);
            return clipped is {} area?target with {Bounds=area}:null;
        }
        return null;
    }
    internal static PixelRect? Area(WindowSnapTarget target,PixelRect allowed,bool client)
    {var clipped=Intersect(client?target.ClientBounds:target.Bounds,allowed);return clipped.Width>=2&&clipped.Height>=2?clipped:null;}
    internal static CaptureMonitor Current(IReadOnlyList<CaptureMonitor> monitors,PixelRect anchor)
    {
        if(monitors.Count==0)throw new CaptureException("capture_target_unavailable","没有可选择的显示器。");
        return monitors.OrderByDescending(m=>{var overlap=Intersect(m.Bounds,anchor);return (long)overlap.Width*overlap.Height;}).ThenByDescending(m=>m.Primary).First();
    }
}
