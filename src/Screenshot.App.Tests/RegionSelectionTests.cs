using Screenshot.App;

internal static class RegionSelectionTests
{
    public static int Run()
    {
        var checks=0;
        void Check(bool condition,string name){if(!condition)throw new Exception(name);checks++;}
        var bounds=new PixelRect(-200,-100,600,400);var model=new RegionSelection(bounds);
        model.Begin(-180,-80);model.Update(-60,40);model.End();
        Check(model.Selection==new PixelRect(-180,-80,120,120),"reverse/negative physical coordinates preserved");
        var handles=new[]{(-180,-80,SelectionHandle.TopLeft),(-120,-80,SelectionHandle.Top),(-60,-80,SelectionHandle.TopRight),(-180,-20,SelectionHandle.Left),(-60,-20,SelectionHandle.Right),(-180,40,SelectionHandle.BottomLeft),(-120,40,SelectionHandle.Bottom),(-60,40,SelectionHandle.BottomRight),(-120,-20,SelectionHandle.Move)};
        foreach(var(x,y,handle)in handles)Check(model.HitTest(x,y)==handle,"selection handle "+handle);
        model.Nudge(1,-1,false);Check(model.Selection==new PixelRect(-179,-81,120,120),"arrow moves exactly one physical pixel");
        model.Nudge(1,1,true);Check(model.Selection==new PixelRect(-179,-81,121,121),"shift arrow resizes one physical pixel");
        model.Nudge(-1000,-1000,false);Check(model.Selection==new PixelRect(-200,-100,121,121),"move clips at top left");
        model.Nudge(1000,1000,false);Check(model.Selection==new PixelRect(279,179,121,121),"move clips at bottom right");
        model.Nudge(-1000,-1000,true);Check(model.Selection==new PixelRect(279,179,2,2),"keyboard resize retains minimum two pixels");
        var drag=new RegionSelection(bounds);drag.Begin(-100,-50);drag.Update(100,150);drag.End();
        drag.Begin(-100,50);drag.Update(500,50);drag.End();Check(drag.Selection==new PixelRect(98,-50,2,200),"edge cannot cross opposite edge");
        var zero=new RegionSelection(bounds);zero.Begin(0,0);zero.End();Check(!zero.HasArea&&zero.Selection is null,"click without area has no editable area");
        zero.Begin(-1000,-1000);zero.Update(1000,1000);zero.End();Check(zero.Selection==bounds,"creation clips to allowed capture bounds");
        foreach(var handle in handles.Take(8))
        {
            var resize=new RegionSelection(bounds);resize.Begin(-180,-80);resize.Update(-60,40);resize.End();
            resize.Begin(handle.Item1,handle.Item2);resize.Update(handle.Item1+5,handle.Item2+5);resize.End();
            Check(resize.HasArea&&resize.Selection!=new PixelRect(-180,-80,120,120),"each handle changes bounds");
        }
        return checks;
    }
}
