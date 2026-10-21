using Screenshot.App;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// 仅用合成像素和假资源验证交接所有权，不创建 Form/Window 或访问桌面。
internal static class CaptureHandoffTests
{
    public static int Run()
    {
        var checks=0;
        void Check(bool value,string name){if(!value)throw new Exception(name);checks++;}
        var pixels=BitmapSource.Create(2,2,96,96,PixelFormats.Bgra32,null,new byte[16],8);pixels.Freeze();
        var area=new PixelRect(0,0,2,2);var image=NativeImages.FromBitmap(pixels,"synthetic.png");
        var first=new FakeHandoff();var second=new FakeHandoff();
        var a=new CapturedFrame(image,pixels,area,area,new[]{new CaptureScreen(area,true)}){Handoff=first};
        var b=new CapturedFrame(image,pixels,area,area,a.Screens){Handoff=second};
        var handoff=new CaptureHandoffState();handoff.Take(a);
        Check(first.Disposals==0,"选区交付不提前释放原生画面");
        first.IsCancelled=true;
        Check(handoff.IsCancelled(a.CaptureId)&&!handoff.IsCancelled(b.CaptureId),"取消只能影响对应捕获");
        handoff.Take(b);Check(first.Disposals==1&&second.Disposals==0,"替换释放旧画面并持有新画面");
        handoff.KeepAbove(a.CaptureId,111);Check(second.Owner==0,"旧捕获不能改变新画面的窗口层级");
        handoff.KeepAbove(b.CaptureId,222);Check(second.Owner==222,"只有当前捕获能建立宿主遮挡关系");
        handoff.Release(a.CaptureId);Check(second.Disposals==0,"迟到应答不能释放新截图");
        handoff.Release(b.CaptureId);Check(second.Disposals==1,"当前布局完成后释放一次");
        handoff.Release();Check(second.Disposals==1,"取消/退出后的重复清理幂等");
        handoff.Take(a with{Handoff=new FakeHandoff()});handoff.Release();
        Check(!handoff.IsCancelled(a.CaptureId),"清理后不保留过期取消标记");
        var state=new CapturePresentationState();state.BeginCapture();state.CompleteCapture(a);
        Check(!state.TryAcceptPainted(a.CaptureId),"没有准备阶段不能接受绘制确认");
        Check(!state.TryPrepare(b.CaptureId)&&state.TryPrepare(a.CaptureId),"准备阶段核对当前捕获身份");
        Check(!state.TryPrepare(a.CaptureId)&&state.PendingCaptureId==a.CaptureId,"准备只接受一次且不提前结束超时保护");
        Check(!state.TryAcceptPainted(b.CaptureId)&&state.TryAcceptPainted(a.CaptureId),"绘制确认只接受当前已准备捕获");
        Check(!state.TryAcceptPainted(a.CaptureId)&&state.PendingCaptureId is null,"绘制确认只完成一次");
        state.BeginCapture();state.CompleteCapture(b);state.TryPrepare(b.CaptureId);state.Dismiss();
        Check(!state.TryAcceptPainted(b.CaptureId),"取消后迟到绘制不能重开窗口");
        state.BeginCapture();state.CompleteCapture(b);state.TryPrepare(b.CaptureId);
        Check(state.TryExpireReady(b.CaptureId)&&!state.IsPrepared(b.CaptureId),"第二阶段超时同样释放准备状态");
        var viewport=new PresentationViewport(3584,1440,1.25);
        Check(viewport.Matches(viewport),"相同客户区与 DPI 可以交接");
        Check(new PresentationViewport(2987,1200,1.5).Matches(new(4480/1.5,1200,1.5)),"分数 DPI 容许一个物理像素取整");
        Check(!new PresentationViewport(4480/1.5,1200,1.5).Matches(viewport),"物理尺寸相同但 DPI 过期不能交接");
        Check(!new PresentationViewport(1100,760,1).Matches(viewport),"浏览器尚未收到尺寸变化不能交接");
        Check(!new PresentationViewport(3581,1440,1.25).Matches(viewport),"超过取整容差不能交接");
        foreach(var invalid in new[]{0d,-1d,double.NaN,double.PositiveInfinity})
        {
            Check(!new PresentationViewport(3584,1440,invalid).Matches(viewport),"无效浏览器 DPI 不能交接");
            Check(!viewport.Matches(new(invalid,1440,1.25)),"无效目标尺寸不能交接");
        }
        return checks;
    }
    private sealed class FakeHandoff : ICaptureHandoff
    {
        public bool IsCancelled { get; set; }
        public int Disposals { get; private set; }
        public nint Owner { get; private set; }
        public void KeepAbove(nint owner)=>Owner=owner;
        public void Dispose()=>Disposals++;
    }
}
