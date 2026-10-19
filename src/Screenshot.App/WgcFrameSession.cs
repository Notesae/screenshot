using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

namespace Screenshot.App;

// 自由线程帧池最多保留一帧；真实捕获只在显式调用时开始，构造后端不会触碰桌面。
internal sealed class WgcFrameSession : ICaptureFrameSession
{
    private readonly object _sync = new();
    private readonly Channel<Direct3D11CaptureFrame> _frames = Channel.CreateBounded<Direct3D11CaptureFrame>(1);
    private GraphicsCaptureItem? _item;
    private IDirect3DDevice? _device;
    private Direct3D11CaptureFramePool? _pool;
    private GraphicsCaptureSession? _session;
    private bool _disposed;
    public CaptureSize BufferSize { get; private set; }

    // 捕获项、帧池、会话和设备由单次截图拥有，任意初始化失败均按相反顺序释放。
    public WgcFrameSession(CaptureTargetKind kind, nint handle)
    {
        try
        {
            if (!GraphicsCaptureSession.IsSupported()) throw new CaptureException("capture_unsupported", "当前系统或图形设备不支持 WGC；可显式选择 GDI 兼容后端。");
            _item = WgcInterop.CreateCaptureItem(kind, handle);
            BufferSize = new(_item.Size.Width, _item.Size.Height); BufferSize.Validate();
            _device = WgcInterop.CreateDevice();
            _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, _item.Size);
            _pool.FrameArrived += OnFrameArrived; _item.Closed += OnItemClosed;
            _session = _pool.CreateCaptureSession(_item);
            _session.IsCursorCaptureEnabled = false;
            _session.StartCapture();
        }
        catch { Dispose(); throw; }
    }

    // 回调只入队一帧；队列已满时立即释放新帧，避免图形缓冲区无限增长。
    private void OnFrameArrived(Direct3D11CaptureFramePool sender, object args)
    {
        lock (_sync)
        {
            if (_disposed) return;
            try
            {
                var frame = sender.TryGetNextFrame();
                if (frame is not null && !_frames.Writer.TryWrite(frame)) frame.Dispose();
            }
            catch (Exception exception) { _frames.Writer.TryComplete(exception); }
        }
    }

    // 目标关闭后作废待消费帧，给等待方返回稳定的目标关闭错误。
    private void OnItemClosed(GraphicsCaptureItem sender, object args)
    {
        lock (_sync)
        {
            if (_disposed) return;
            while (_frames.Reader.TryRead(out var pending)) CloseQuietly(pending);
            _frames.Writer.TryComplete(new CaptureException("capture_target_closed", "截图目标已关闭或移除。"));
        }
    }

    public async Task<ICaptureFrameLease> NextFrameAsync(CancellationToken token)
    {
        try { return new FrameLease(await _frames.Reader.ReadAsync(token).ConfigureAwait(false)); }
        catch (ChannelClosedException exception) when (exception.InnerException is not null) { throw exception.InnerException; }
    }

    // reader 已释放旧租约后才调用；同时清空队列，避免旧大小的表面被误当成新帧。
    public void Recreate(CaptureSize size)
    {
        size.Validate();
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            while (_frames.Reader.TryRead(out var pending)) CloseQuietly(pending);
            _pool!.Recreate(_device!, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, new SizeInt32 { Width = size.Width, Height = size.Height });
            BufferSize = size;
        }
    }

    // 先停止帧流再释放帧池和设备，清理所有尚未交给 reader 的帧。
    public void Dispose()
    {
        Direct3D11CaptureFramePool? pool; GraphicsCaptureItem? item; GraphicsCaptureSession? session; IDirect3DDevice? device;
        lock (_sync)
        {
            if (_disposed) return; _disposed = true;
            pool = _pool; item = _item; session = _session; device = _device;
            _pool = null; _item = null; _session = null; _device = null;
            _frames.Writer.TryComplete();
            while (_frames.Reader.TryRead(out var pending)) CloseQuietly(pending);
        }
        // 在锁外解除回调和关闭 COM 资源，避免底层等待回调时与 _sync 互相等待。
        try { if (pool is not null) pool.FrameArrived -= OnFrameArrived; } catch (Exception error) when (error is COMException or ObjectDisposedException) { }
        try { if (item is not null) item.Closed -= OnItemClosed; } catch (Exception error) when (error is COMException or ObjectDisposedException) { }
        CloseQuietly(session); CloseQuietly(pool); CloseQuietly(device);
    }

    // 目标关闭或设备丢失后 Close 可能再次报告 COM 错误，仍必须继续清理剩余资源。
    private static void CloseQuietly(IDisposable? resource) { try { resource?.Dispose(); } catch (Exception error) when (error is COMException or ObjectDisposedException) { } }

    // 租约持有 WinRT 帧，SoftwareBitmap 深拷贝完成前绝不归还表面到帧池。
    private sealed class FrameLease(Direct3D11CaptureFrame frame) : ICaptureFrameLease
    {
        public CaptureSize ContentSize => new(frame.ContentSize.Width, frame.ContentSize.Height);
        public async Task<CapturePixels> CopyPixelsAsync(CancellationToken token)
        {
            using var copy = await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface).AsTask(token).ConfigureAwait(false);
            if (copy.BitmapPixelFormat == BitmapPixelFormat.Bgra8 && copy.BitmapAlphaMode == BitmapAlphaMode.Straight)
                return WgcInterop.CopySoftwareBitmap(copy, token);
            // WPF/PNG 使用直通 alpha；转换忽略或预乘 alpha 的表示，避免透明边缘变暗。
            using var converted = SoftwareBitmap.Convert(copy, BitmapPixelFormat.Bgra8, BitmapAlphaMode.Straight);
            return WgcInterop.CopySoftwareBitmap(converted, token);
        }
        public void Dispose() => CloseQuietly(frame);
    }
}
