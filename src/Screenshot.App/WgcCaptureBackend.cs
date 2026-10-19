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
        var acquired = await _acquisition.AcquireAsync(request, token);
        var selected = acquired.Selection; var imagePixels = acquired.Selected;
        if (request.Region)
        {
            using var frozen = ToDrawingBitmap(acquired.Backdrop);
            using var overlay = new RegionOverlay(frozen, new Rectangle(acquired.DesktopBounds.X, acquired.DesktopBounds.Y, acquired.DesktopBounds.Width, acquired.DesktopBounds.Height), selected, request.SnapWindows ? WindowsWindowTargets.Snapshot() : null, request.SnapClientArea);
            if (overlay.ShowDialog() != DialogResult.OK) return null;
            selected = overlay.Selection;
            imagePixels = CapturePixelGeometry.Crop(acquired.Selected,
                new(selected.X - acquired.Selection.X, selected.Y - acquired.Selection.Y, selected.Width, selected.Height));
        }
        token.ThrowIfCancellationRequested();
        var image = NativeImages.FromBitmap(ToBitmapSource(imagePixels), request.Target.Kind == CaptureTargetKind.Window ? "窗口截图.png" : request.Region ? "区域截图.png" : "屏幕截图.png");
        return new(image, ToBitmapSource(acquired.Backdrop), acquired.DesktopBounds, selected, acquired.Screens) { Backend = Id };
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
