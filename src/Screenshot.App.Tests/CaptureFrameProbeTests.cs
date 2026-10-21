using Screenshot.App;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// 只将生成的 DrawingImage 栅格化到采样行；不创建窗口或调用屏幕捕获 API。
internal static class CaptureFrameProbeTests
{
    public static int Run()
    {
        Exception? failure=null;var count=0;
        var thread=new Thread(()=>{
            try
            {
                void Check(bool value,string message){if(!value)throw new Exception(message);count++;}
                var pixels=new byte[320*240*4];for(var i=3;i<pixels.Length;i+=4)pixels[i]=255;
                var frozen=BitmapSource.Create(320,240,96,96,PixelFormats.Bgra32,null,pixels,320*4);frozen.Freeze();
                var bounds=new PixelRect(-320,-100,320,240);var selection=new PixelRect(-240,-30,160,100);
                var probe=new CaptureFrameProbe(frozen,bounds,selection,1,128);
                DrawingImage Frame(Rect? selected,byte shade=128)
                {
                    var group=new DrawingGroup();using(var context=group.Open()){
                        context.DrawRectangle(new SolidColorBrush(Color.FromArgb(shade,0,0,0)),null,new Rect(0,0,320,240));
                        if(selected is {} area)context.DrawRectangle(Brushes.White,null,area);
                    }return new DrawingImage(group);
                }
                Check(!probe.Accept(Frame(null,0)),"透明空帧不能撤挡");
                Check(!probe.Accept(Frame(new Rect(0,0,320,240))),"未遮罩的整张底图不能撤挡");
                Check(!probe.Accept(Frame(new Rect(0,0,80,60))),"旧选区遮罩不能撤挡");
                Check(!probe.Accept(Frame(new Rect(80,70,160,100),0)),"只有新底图、没有遮罩不能撤挡");
                Check(probe.Accept(Frame(new Rect(80,70,160,100))),"当前底图与遮罩同时存在才撤挡");
                Check(probe.RejectedFrames==4,"记录拒绝帧数便于诊断");
                var full=new CaptureFrameProbe(frozen,bounds,bounds,1.5,128);
                Check(full.Accept(Frame(new Rect(0,0,320,240))),"选区覆盖整个桌面时不要求不存在的外部遮罩");
                Check(!full.Accept(Frame(null,0)),"全桌面选区仍拒绝空帧");
            }
            catch(Exception error){failure=error;}
        });
        thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();
        if(failure is not null)throw new Exception("合成帧像素校验失败",failure);return count;
    }
}
