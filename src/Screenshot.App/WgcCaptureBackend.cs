using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Screenshot.App;

// WGC SDR 主后端：先取得原生冻结桌面，再把指定目标或区域作为唯一可导出的图像。
public sealed class WgcCaptureBackend : ICaptureBackend
{
    private readonly CaptureAcquisition _acquisition = new(new WindowsCapturePlatform());
    public string Id => "wgc";
    public bool SupportsHdr => false;

    // 后台获取帧后回到调用方上下文，区域控件仍在原生 UI 线程运行。
    public async Task<CapturedFrame?> CaptureAsync(CaptureRequest request, CancellationToken token)
    {
        var acquired=await _acquisition.AcquireAsync(request,token);
        CaptureDiagnostics.Current.Value?.Mark("pixels_acquired");
        var backdrop=ToBitmapSource(acquired.Backdrop);
        var selected=acquired.Selection;
        RegionOverlay? overlay=null;Bitmap? frozen=null;var transferred=false;
        try
        {
            if(request.Region)
            {
                frozen=ToDrawingBitmap(acquired.Backdrop);
                CaptureDiagnostics.Current.Value?.Mark("selection_pixels_prepared");
                overlay=new RegionOverlay(frozen,new Rectangle(acquired.DesktopBounds.X,acquired.DesktopBounds.Y,acquired.DesktopBounds.Width,acquired.DesktopBounds.Height),selected,request.SnapWindows?WindowsWindowTargets.Snapshot():null,request.SnapClientArea);
                var area=await overlay.SelectAsync(token);if(area is null)return null;selected=area.Value;
            }
            // PNG 编码不占原生 UI 线程；原生选区在等待期间仍显示冻结画面并可取消。
            var image=await Task.Run(()=>
            {
                var pixels=request.Region?CapturePixelGeometry.Crop(acquired.Selected,new(selected.X-acquired.Selection.X,selected.Y-acquired.Selection.Y,selected.Width,selected.Height)):acquired.Selected;
                return NativeImages.FromBitmap(ToBitmapSource(pixels),request.Target.Kind==CaptureTargetKind.Window?"窗口截图.png":request.Region?"区域截图.png":"屏幕截图.png");
            },token);
            token.ThrowIfCancellationRequested();if(overlay?.IsCancelled==true)return null;
            CaptureDiagnostics.Current.Value?.Mark("image_encoded");
            var frame=new CapturedFrame(image,backdrop,acquired.DesktopBounds,selected,acquired.Screens){Backend=Id,Handoff=overlay};
            transferred=overlay is not null;return frame;
        }
        finally{if(!transferred){if(overlay is not null)overlay.Dispose();else frozen?.Dispose();}}
    }

    private static BitmapSource ToBitmapSource(CapturePixels pixels)
    {
        var source = BitmapSource.Create(pixels.Size.Width, pixels.Size.Height, 96, 96, PixelFormats.Bgra32, null, pixels.Bytes, pixels.Stride);
        source.Freeze(); return source;
    }

    // 仅为已有原生选区控件构建离屏位图，不读取屏幕或窗口内容。
    private static Bitmap ToDrawingBitmap(CapturePixels pixels)
    {
        var bitmap = new Bitmap(pixels.Size.Width, pixels.Size.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try
        {
            var locked = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.WriteOnly, bitmap.PixelFormat);
            try
            {
                for (var y = 0; y < bitmap.Height; y++)
                    Marshal.Copy(pixels.Bytes, y * pixels.Stride, IntPtr.Add(locked.Scan0, y * locked.Stride), pixels.Size.Width * 4);
            }
            finally { bitmap.UnlockBits(locked); }
            return bitmap;
        }
        catch { bitmap.Dispose(); throw; }
    }
}
