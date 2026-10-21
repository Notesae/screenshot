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
        handoff.Release(a.CaptureId);Check(second.Disposals==0,"迟到应答不能释放新截图");
        handoff.Release(b.CaptureId);Check(second.Disposals==1,"当前布局完成后释放一次");
        handoff.Release();Check(second.Disposals==1,"取消/退出后的重复清理幂等");
        handoff.Take(a with{Handoff=new FakeHandoff()});handoff.Release();
        Check(!handoff.IsCancelled(a.CaptureId),"清理后不保留过期取消标记");
        return checks;
    }
    private sealed class FakeHandoff : ICaptureHandoff
    {
        public bool IsCancelled { get; set; }
        public int Disposals { get; private set; }
        public void Dispose()=>Disposals++;
    }
}
