using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;

namespace Screenshot.App;

// WinRT 会把部分 HRESULT 投影为 .NET 异常，统一映射而不依赖单一 COMException 类型。
internal static class CaptureErrors
{
    public static CaptureException? Map(Exception error) => error switch
    {
        CaptureException existing => existing,
        _ when error.HResult == unchecked((int)0x80070005) || error is UnauthorizedAccessException
            => new("capture_access_denied", "WGC 无权捕获该目标；请检查系统权限和目标保护状态。", error),
        _ when error.HResult is unchecked((int)0x887A0005) or unchecked((int)0x887A0006) or unchecked((int)0x887A0007)
            => new("capture_device_lost", "图形设备已移除或重置，请重新截图。", error),
        _ when error.HResult == unchecked((int)0x80000013) || error is ObjectDisposedException
            => new("capture_target_closed", "截图目标或捕获资源已关闭。", error),
        _ when error is TypeLoadException or DllNotFoundException or EntryPointNotFoundException or PlatformNotSupportedException
            => new("capture_unsupported", "当前系统不支持所需 WGC 接口；可显式选择 GDI 兼容后端。", error),
        COMException => new("capture_failed", "WGC 无法完成捕获，可显式选择 GDI 兼容后端后重试。", error),
        _ => null
    };
}

// 原生像素缓冲区的尺寸，独立于窗口 DIP 与 CSS 尺寸。
public readonly record struct CaptureSize(int Width, int Height)
{
    public void Validate()
    {
        if (Width <= 0 || Height <= 0 || Width > 32768 || Height > 32768 || (long)Width * Height > 100_000_000)
            throw new CaptureException("capture_size_invalid", "捕获尺寸无效或超过一亿像素限制。");
    }
}

// 拷贝到 CPU 的 BGRA8 SDR 数据；每行保留明确 stride，不引用帧池或 GPU 资源。
public sealed class CapturePixels
{
    public CaptureSize Size { get; }
    public byte[] Bytes { get; }
    public int Stride { get; }
    public CapturePixels(CaptureSize size, byte[] bytes, int stride)
    {
        size.Validate();
        if (stride < checked(size.Width * 4) || (long)stride * size.Height > bytes.LongLength)
            throw new CaptureException("capture_buffer_invalid", "捕获像素缓冲区长度或行跨度无效。");
        Size = size; Bytes = bytes; Stride = stride;
    }
}

// 单帧租约在深拷贝完成前持有底层资源，释放后不得继续访问其表面。
internal interface ICaptureFrameLease : IDisposable
{
    CaptureSize ContentSize { get; }
    Task<CapturePixels> CopyPixelsAsync(CancellationToken token);
}

// 真实帧池和假帧池使用相同契约，以便在不触碰桌面的测试中验证生命周期。
internal interface ICaptureFrameSession : IDisposable
{
    CaptureSize BufferSize { get; }
    Task<ICaptureFrameLease> NextFrameAsync(CancellationToken token);
    void Recreate(CaptureSize size);
}

// 获取稳定尺寸的一帧；尺寸变化时先归还旧帧，再重新创建帧池，不复制未定义边缘。
internal static class CaptureFrameReader
{
    public static async Task<CapturePixels> ReadAsync(ICaptureFrameSession session, TimeSpan timeout, CancellationToken token)
    {
        using (session)
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(token))
        {
            deadline.CancelAfter(timeout);
            try
            {
                while (true)
                {
                    deadline.Token.ThrowIfCancellationRequested();
                    CaptureSize? resized = null;
                    using (var frame = await session.NextFrameAsync(deadline.Token).ConfigureAwait(false))
                    {
                        frame.ContentSize.Validate();
                        if (frame.ContentSize != session.BufferSize) resized = frame.ContentSize;
                        else
                        {
                            var pixels = await frame.CopyPixelsAsync(deadline.Token).ConfigureAwait(false);
                            deadline.Token.ThrowIfCancellationRequested();
                            if (pixels.Size != frame.ContentSize) throw new CaptureException("capture_geometry_changed", "捕获内容在复制期间改变尺寸，请重新截图。");
                            return pixels;
                        }
                    }
                    if (resized is { } size) session.Recreate(size);
                }
            }
            catch (OperationCanceledException) when (!token.IsCancellationRequested)
            { throw new CaptureException("capture_timeout", "等待截图帧超时，请检查目标是否可见或重试。"); }
        }
    }
}

// 将多个显示器的物理像素无缩放合成为冻结桌面，屏幕空隙保留透明黑。
internal static class CapturePixelGeometry
{
    public static CapturePixels Compose(PixelRect bounds, IReadOnlyList<(PixelRect Bounds, CapturePixels Pixels)> frames)
    {
        var size = new CaptureSize(bounds.Width, bounds.Height); size.Validate();
        var stride = checked(bounds.Width * 4); var bytes = new byte[checked(stride * bounds.Height)];
        foreach (var frame in frames)
        {
            ValidateContained(bounds, frame.Bounds);
            if (frame.Bounds.Width != frame.Pixels.Size.Width || frame.Bounds.Height != frame.Pixels.Size.Height)
                throw new CaptureException("capture_geometry_changed", "显示器像素与物理边界不一致，请重新截图。");
            for (var y = 0; y < frame.Bounds.Height; y++)
                Buffer.BlockCopy(frame.Pixels.Bytes, y * frame.Pixels.Stride, bytes,
                    (frame.Bounds.Y - bounds.Y + y) * stride + (frame.Bounds.X - bounds.X) * 4, frame.Bounds.Width * 4);
        }
        return new(size, bytes, stride);
    }

    // 裁剪时仅复制选区像素；冻结桌面的其他内容不会进入返回的图片缓冲区。
    public static CapturePixels Crop(CapturePixels source, PixelRect relative)
    {
        ValidateContained(new(0, 0, source.Size.Width, source.Size.Height), relative);
        var stride = checked(relative.Width * 4); var bytes = new byte[checked(stride * relative.Height)];
        for (var y = 0; y < relative.Height; y++)
            Buffer.BlockCopy(source.Bytes, (relative.Y + y) * source.Stride + relative.X * 4, bytes, y * stride, stride);
        return new(new(relative.Width, relative.Height), bytes, stride);
    }

    public static void ValidateContained(PixelRect bounds, PixelRect selected)
    {
        if (selected.Width <= 0 || selected.Height <= 0 || selected.X < bounds.X || selected.Y < bounds.Y
            || (long)selected.X + selected.Width > (long)bounds.X + bounds.Width || (long)selected.Y + selected.Height > (long)bounds.Y + bounds.Height)
            throw new CaptureException("capture_target_outside_desktop", "捕获目标超出可呈现的桌面范围。");
    }
}
