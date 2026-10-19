using Screenshot.App;
internal static class CaptureTargetsTests
{
    public static int Run()
    {
        var count=0;void Check(bool ok,string label){if(!ok)throw new Exception(label);count++;}
        var monitors=new[]{new CaptureMonitor(1,new(-1920,-240,1920,1080),false),new CaptureMonitor(2,new(0,0,2560,1440),true)};
        Check(CaptureTargets.Current(monitors,new(-1500,100,800,600)).Handle==1,"negative monitor selected by window intersection");
        Check(CaptureTargets.Current(monitors,new(-100,100,400,600)).Handle==2,"mixed monitor overlap uses physical area");
        Check(CaptureTargets.Current(monitors,new(9000,9000,1,1)).Handle==2,"offscreen anchor falls back to primary");
        var top=new WindowSnapTarget(10,new(-100,20,300,200),new(-90,50,280,160));var behind=new WindowSnapTarget(11,new(-300,0,900,900),new(-290,30,880,860));
        var windows=new[]{top,behind};var allowed=new PixelRect(-200,0,500,400);
        Check(CaptureTargets.AtPoint(windows,0,30,allowed,false)?.Handle==10,"snap chooses foreground geometry");
        Check(CaptureTargets.AtPoint(windows,0,30,allowed,true)?.Bounds==top.ClientBounds,"titlebar click may select matching client area");
        Check(CaptureTargets.AtPoint(windows,250,250,allowed,false)?.Bounds==new PixelRect(-200,0,500,400),"partly offscreen window clips to capture bounds");
        Check(CaptureTargets.AtPoint(windows,800,30,allowed,false) is null,"outside window has no snap");
        Check(CaptureTargets.AtPoint(new[]{top with {ClientBounds=new(0,0,0,0)},behind},0,30,allowed,true) is null,"empty foreground client does not snap through to lower window");
        var model=new RegionSelection(allowed);model.Set(new(-500,-500,1000,1000));Check(model.Selection==allowed,"snap selection reuses adjustment bounds");
        model.Nudge(1,1,true);Check(model.Selection==allowed,"snapped selection cannot exceed capture bounds");
        Check(CaptureTargets.Area(top,allowed,true)==top.ClientBounds&&CaptureTargets.Area(top,allowed,false)==top.Bounds,"selected snap can toggle client and full area before confirmation");
        return count;
    }
}
