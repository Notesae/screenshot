using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Screenshot.App;

// 校验现有 WebView 图像中的少量 alpha 样本；不读取桌面、不保存像素、不重新捕获屏幕。
internal sealed class CaptureFrameProbe
{
    private readonly int _width,_height;
    private readonly List<(int X,int Y,byte Alpha)> _samples=new();
    public int RejectedFrames { get; private set; }
    public string LastResult { get; private set; }="none";
    public CaptureFrameProbe(BitmapSource frozen,PixelRect desktop,PixelRect selection,double scale,byte maskAlpha)
    {
        _width=desktop.Width;_height=desktop.Height;
        var x=selection.X-desktop.X;var y=selection.Y-desktop.Y;var gap=Math.Max(24,(int)Math.Ceiling(24*scale));
        // 内部样本核对已解码底图，外部样本核对遮罩；避开柔光、手柄和顶部尺寸标签。
        void Add(int px,int py)
        {
            if(px<0||py<0||px>=_width||py>=_height)return;
            var inside=px>=x&&px<x+selection.Width&&py>=y&&py<y+selection.Height;
            if(!inside&&py>=y-64*scale&&py<y&&px>=x&&px<x+256*scale)return;
            var alpha=maskAlpha;
            if(inside){var pixel=new byte[4];frozen.CopyPixels(new Int32Rect(px,py,1,1),pixel,4,0);alpha=pixel[3];if(alpha==0)return;}
            _samples.Add((px,py,alpha));
        }
        foreach(var fx in new[]{.2,.5,.8})foreach(var fy in new[]{.2,.5,.8})Add(x+(int)(selection.Width*fx),y+(int)(selection.Height*fy));
        Add(x-gap,y+selection.Height/2);Add(x+selection.Width+gap,y+selection.Height/2);
        Add(x+selection.Width/2,y-(int)Math.Ceiling(64*scale));Add(x+selection.Width/2,y+selection.Height+gap);
        foreach(var px in new[]{gap,_width-gap-1})foreach(var py in new[]{gap,_height-gap-1})Add(px,py);
    }
    // 将所有采样点合成一行再统一读回，避免为每个像素分别创建整张合成位图。
    public bool Accept(ImageSource source)
    {
        if(_samples.Count==0||!double.IsFinite(source.Width)||!double.IsFinite(source.Height)||source.Width<=0||source.Height<=0){LastResult="empty";RejectedFrames++;return false;}
        var visual=new DrawingVisual();RenderOptions.SetBitmapScalingMode(visual,BitmapScalingMode.NearestNeighbor);
        using(var drawing=visual.RenderOpen())for(var i=0;i<_samples.Count;i++)
        {
            var sample=_samples[i];drawing.PushClip(new RectangleGeometry(new Rect(i,0,1,1)));
            drawing.DrawImage(source,new Rect(i-sample.X,-sample.Y,_width,_height));drawing.Pop();
        }
        var bitmap=new RenderTargetBitmap(_samples.Count,1,96,96,PixelFormats.Pbgra32);bitmap.Render(visual);
        var pixels=new byte[_samples.Count*4];bitmap.CopyPixels(pixels,pixels.Length,0);
        for(var i=0;i<_samples.Count;i++)if(Math.Abs(pixels[i*4+3]-_samples[i].Alpha)>3){LastResult=pixels[i*4+3]==0?"transparent":pixels[i*4+3]==255?"opaque":"mismatch";RejectedFrames++;return false;}
        LastResult="ready";
        return true;
    }
}
