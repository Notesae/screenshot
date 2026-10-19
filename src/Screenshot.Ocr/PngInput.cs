using System.Buffers.Binary;
using OpenCvSharp;

namespace Screenshot.Ocr;

/// <summary>解压前限制 PNG 大小，并把透明背景合成到白色以保持文字对比。</summary>
internal static class PngInput
{
    internal const int MaxBytes = 20 * 1024 * 1024;
    internal const int MaxSide = 16000;
    internal const long MaxPixels = 32_000_000;

    // 先读取固定 PNG/IHDR 字段，避免按不可信图片尺寸直接分配原生内存。
    internal static (int Width, int Height) ReadSize(byte[] png)
    {
        if (png is null || png.Length < 33 || !png.AsSpan(0,8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10})
            || BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(8,4)) != 13 || !png.AsSpan(12,4).SequenceEqual("IHDR"u8))
            throw new LocalOcrException("invalid_image", "本地 OCR 仅接受有效的 PNG 图片，请重新导入。");
        if (png.Length > MaxBytes) throw new LocalOcrException("image_too_large", "本地 OCR 图片不能超过 20 MB，请缩小图片或选区。");
        var width = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16,4));
        var height = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20,4));
        if (width <= 0 || height <= 0) throw new LocalOcrException("invalid_image", "PNG 图片尺寸无效。");
        if (width > MaxSide || height > MaxSide || (long)width * height > MaxPixels)
            throw new LocalOcrException("image_too_large", "本地 OCR 最多处理 3200 万像素，单边不超过 16000 像素，请缩小选区。");
        return (width,height);
    }

    // 只解码内存图片；四通道透明像素以白色混合，不调用屏幕或窗口接口。
    internal static unsafe Mat DecodeToBgr(byte[] png,CancellationToken token=default)
    {
        var expected = ReadSize(png);
        using var raw = Cv2.ImDecode(png,ImreadModes.Unchanged);
        if (raw.Empty() || raw.Width != expected.Width || raw.Height != expected.Height)
            throw new LocalOcrException("invalid_image", "PNG 图片数据损坏，无法解码。");
        using var eightBit = new Mat();
        raw.ConvertTo(eightBit,MatType.CV_8UC(raw.Channels()),raw.ElemSize1() == 2 ? 1.0/257 : 1);
        int width=raw.Width, height=raw.Height;
        var result = new Mat(height,width,MatType.CV_8UC3);
        try
        {
            if (eightBit.Channels() == 1) Cv2.CvtColor(eightBit,result,ColorConversionCodes.GRAY2BGR);
            else if (eightBit.Channels() == 3) eightBit.CopyTo(result);
            else if (eightBit.Channels() == 4)
            {
                for(int y=0;y<height;y++)
                {
                    token.ThrowIfCancellationRequested();
                    var source=(byte*)eightBit.Ptr(y); var destination=(byte*)result.Ptr(y);
                    for(int x=0;x<width;x++) for(int channel=0;channel<3;channel++)
                    {
                        int alpha=source[x*4+3];
                        destination[x*3+channel]=(byte)((source[x*4+channel]*alpha+255*(255-alpha)+127)/255);
                    }
                }
            }
            else throw new LocalOcrException("invalid_image", "PNG 图片颜色通道不受支持。");
            return result;
        }
        catch { result.Dispose(); throw; }
    }
}
