using System;
using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Screenshot.App;

internal enum ClipboardImageStatus { Ready, Busy, MarkerMissing, Replaced, PngMissing, DibMissing, Incomplete }

// 后台只生成独立字节，STA 线程提交；系统持久化后不再依赖解码器、前端缓存或隐藏窗口。
internal sealed class ClipboardImagePayload
{
    private const int DibV5 = 17, HeaderSize = 124;
    private readonly byte[] _png, _dib;
    private const string CopyMarker = "Screenshot.ImageCopy.v1";
    private readonly Guid _copyId = Guid.NewGuid();
    public int Width { get; }
    public int Height { get; }

    public ClipboardImagePayload(byte[] png, BitmapSource image)
    {
        _png = png; Width = image.PixelWidth; Height = image.PixelHeight;
        var stride = checked(Width * 4); var pixelBytes = checked(stride * Height);
        _dib = GC.AllocateUninitializedArray<byte>(checked(HeaderSize + pixelBytes));
        _dib.AsSpan(0, HeaderSize).Clear();
        // BITMAPV5HEADER：顶向下 BGRA、显式 alpha 位掩码与 sRGB；不拷贝 BMP 文件头或重新压缩 PNG。
        var header = _dib.AsSpan(0, HeaderSize);
        BinaryPrimitives.WriteInt32LittleEndian(header, HeaderSize);
        BinaryPrimitives.WriteInt32LittleEndian(header[4..], Width);
        BinaryPrimitives.WriteInt32LittleEndian(header[8..], -Height);
        BinaryPrimitives.WriteUInt16LittleEndian(header[12..], 1);
        BinaryPrimitives.WriteUInt16LittleEndian(header[14..], 32);
        BinaryPrimitives.WriteUInt32LittleEndian(header[16..], 3); // BI_BITFIELDS
        BinaryPrimitives.WriteInt32LittleEndian(header[20..], pixelBytes);
        BinaryPrimitives.WriteInt32LittleEndian(header[24..], PixelsPerMeter(image.DpiX));
        BinaryPrimitives.WriteInt32LittleEndian(header[28..], PixelsPerMeter(image.DpiY));
        BinaryPrimitives.WriteUInt32LittleEndian(header[40..], 0x00ff0000);
        BinaryPrimitives.WriteUInt32LittleEndian(header[44..], 0x0000ff00);
        BinaryPrimitives.WriteUInt32LittleEndian(header[48..], 0x000000ff);
        BinaryPrimitives.WriteUInt32LittleEndian(header[52..], 0xff000000);
        BinaryPrimitives.WriteUInt32LittleEndian(header[56..], 0x73524742); // LCS_sRGB
        BinaryPrimitives.WriteUInt32LittleEndian(header[108..], 4); // LCS_GM_IMAGES
        var pixels = image.Format == PixelFormats.Bgra32 ? image : new FormatConvertedBitmap(image, PixelFormats.Bgra32, null, 0);
        pixels.CopyPixels(new Int32Rect(0, 0, Width, Height), _dib, stride, HeaderSize);
    }

    private static int PixelsPerMeter(double dpi) => (int)Math.Clamp(Math.Round((double.IsFinite(dpi) && dpi > 0 ? dpi : 96) / .0254), 1, int.MaxValue);

    public void Write()
    {
        RequireSta();
        using var png = new MemoryStream(_png, writable: false);
        using var dib = new MemoryStream(_dib, writable: false);
        using var marker = new MemoryStream(_copyId.ToByteArray(), writable: false);
        var data = new DataObject();
        data.SetData("PNG", png, autoConvert: false);
        // 按系统格式 ID 取得名称并缓存映射，避免把 CF_DIBV5 误注册成新的私有格式。
        data.SetData(DataFormats.GetDataFormat(DibV5).Name, dib, autoConvert: false);
        data.SetData(CopyMarker, marker, autoConvert: false);
        Clipboard.SetDataObject(data, copy: true);
    }

    // 只核对本次写入的格式、原生数据句柄与长度，不解码或读取用户之前的剪贴板内容。
    public ClipboardImageStatus Confirm()
    {
        RequireSta();
        // 独立标记只确认本次复制，避免系统合成兼容格式改变序号时误判失败。
        if (!OpenClipboard(IntPtr.Zero)) return ClipboardImageStatus.Busy;
        try
        {
            var marker = GetClipboardData((uint)DataFormats.GetDataFormat(CopyMarker).Id);
            if (marker == IntPtr.Zero || GlobalSize(marker).ToUInt64() < 16) return ClipboardImageStatus.MarkerMissing;
            var address = GlobalLock(marker);
            if (address == IntPtr.Zero) return ClipboardImageStatus.MarkerMissing;
            try { var bytes = new byte[16]; Marshal.Copy(address, bytes, 0, bytes.Length); if (new Guid(bytes) != _copyId) return ClipboardImageStatus.Replaced; }
            finally { GlobalUnlock(marker); }
            var png = GetClipboardData((uint)DataFormats.GetDataFormat("PNG").Id);
            var dib = GetClipboardData(DibV5);
            if (png == IntPtr.Zero) return ClipboardImageStatus.PngMissing;
            if (dib == IntPtr.Zero) return ClipboardImageStatus.DibMissing;
            return GlobalSize(png).ToUInt64() >= (ulong)_png.Length && GlobalSize(dib).ToUInt64() >= (ulong)_dib.Length
                ? ClipboardImageStatus.Ready : ClipboardImageStatus.Incomplete;
        }
        finally { CloseClipboard(); }
    }

    private static void RequireSta()
    {
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA) throw new InvalidOperationException("图片复制必须在主线程完成。");
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GlobalUnlock(IntPtr memory);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern UIntPtr GlobalSize(IntPtr memory);
}
