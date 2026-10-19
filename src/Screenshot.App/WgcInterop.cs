using System;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Foundation;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

namespace Screenshot.App;

// 只封装 WinRT 投影之外必要的 D3D/桌面目标互操作，不添加第三方图形依赖。
internal static class WgcInterop
{
    private static readonly Guid ItemInteropId = new("3628e81b-3cac-4c60-b7f4-23ce0e0c3356");
    private static readonly Guid CaptureItemId = new("79c3f95b-31f7-4ec2-a464-632ef5d30760");
    private static readonly Guid DxgiDeviceId = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
    private static readonly Guid MemoryBufferAccessId = new("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d");
    [DllImport("d3d11.dll", ExactSpelling = true)]
    private static extern int D3D11CreateDevice(nint adapter, int driverType, nint software, uint flags, nint levels, uint levelCount, uint sdkVersion, out nint device, out int featureLevel, out nint context);
    [DllImport("d3d11.dll", ExactSpelling = true)] private static extern int CreateDirect3D11DeviceFromDXGIDevice(nint device, out nint graphicsDevice);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int CreateItem(nint factory, nint handle, ref Guid iid, out nint item);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int AccessMemory(nint reference, out nint data, out uint capacity);

    // 官方 IGraphicsCaptureItemInterop 的前三个槽为 IUnknown，后续依次为窗口与显示器。
    public static GraphicsCaptureItem CreateCaptureItem(CaptureTargetKind kind, nint handle)
    {
        using var factory = WinRT.ActivationFactory.Get("Windows.Graphics.Capture.GraphicsCaptureItem", ItemInteropId);
        var slot = kind == CaptureTargetKind.Window ? 3 : 4;
        var create = Marshal.GetDelegateForFunctionPointer<CreateItem>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(factory.ThisPtr), slot * IntPtr.Size));
        var id = CaptureItemId; nint item = 0;
        try
        {
            Marshal.ThrowExceptionForHR(create(factory.ThisPtr, handle, ref id, out item));
            return WinRT.MarshalInspectable<GraphicsCaptureItem>.FromAbi(item);
        }
        finally { if (item != 0) Marshal.Release(item); }
    }

    // 创建 BGRA 兼容硬件 D3D11 设备；失败明确上报，不默默切换 GDI。
    public static IDirect3DDevice CreateDevice()
    {
        nint device = 0, context = 0, dxgi = 0, projected = 0;
        try
        {
            Marshal.ThrowExceptionForHR(D3D11CreateDevice(0, 1, 0, 0x20, 0, 0, 7, out device, out _, out context));
            var id = DxgiDeviceId;
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, in id, out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out projected));
            return WinRT.MarshalInterface<IDirect3DDevice>.FromAbi(projected);
        }
        finally
        {
            if (projected != 0) Marshal.Release(projected);
            if (dxgi != 0) Marshal.Release(dxgi);
            if (context != 0) Marshal.Release(context);
            if (device != 0) Marshal.Release(device);
        }
    }

    // 锁定 SoftwareBitmap 的 CPU 平面后逐行深拷贝；不把 GPU 表面或整桌面交给前端。
    public static CapturePixels CopySoftwareBitmap(SoftwareBitmap bitmap, CancellationToken token)
    {
        var size = new CaptureSize(bitmap.PixelWidth, bitmap.PixelHeight); size.Validate();
        using var buffer = bitmap.LockBuffer(BitmapBufferAccessMode.Read);
        using var reference = buffer.CreateReference();
        var plane = buffer.GetPlaneDescription(0);
        var abi = WinRT.MarshalInterface<IMemoryBufferReference>.FromManaged(reference);
        nint access = 0;
        try
        {
            var id = MemoryBufferAccessId;
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(abi, in id, out access));
            var read = Marshal.GetDelegateForFunctionPointer<AccessMemory>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(access), 3 * IntPtr.Size));
            Marshal.ThrowExceptionForHR(read(access, out var data, out var capacity));
            var stride = checked(size.Width * 4);
            if (plane.Width < size.Width || plane.Height < size.Height || plane.Stride < stride || plane.StartIndex < 0 || (long)plane.StartIndex + (long)(size.Height - 1) * plane.Stride + stride > capacity)
                throw new CaptureException("capture_buffer_invalid", "WGC 像素平面范围无效。");
            var bytes = new byte[checked(stride * size.Height)];
            for (var y = 0; y < size.Height; y++)
            {
                token.ThrowIfCancellationRequested();
                Marshal.Copy(IntPtr.Add(data, checked(plane.StartIndex + y * plane.Stride)), bytes, y * stride, stride);
            }
            return new(size, bytes, stride);
        }
        finally { if (access != 0) Marshal.Release(access); if (abi != 0) Marshal.Release(abi); }
    }
}
