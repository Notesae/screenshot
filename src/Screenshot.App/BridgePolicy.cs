using System;

namespace Screenshot.App;

// 集中定义原生桥的信任来源、数据大小和文件名边界。
public static class BridgePolicy
{
    public const string Origin = "https://app.screenshot.local/";
    public const int MaxDocumentBytes = 64 * 1024 * 1024;
    public static bool IsTrustedSource(string? source) => Uri.TryCreate(source, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.Host == "app.screenshot.local" && uri.IsDefaultPort
        && string.IsNullOrEmpty(uri.UserInfo);
    public static string SafeName(string? name, string fallback)
    {
        var value = System.IO.Path.GetFileName((name ?? "").Replace('\\', '/'));
        return string.IsNullOrWhiteSpace(value) || value.IndexOfAny(System.IO.Path.GetInvalidFileNameChars()) >= 0 ? fallback : value;
    }
}

// 使用虚拟桌面的物理像素坐标；X、Y 可为负数。
public readonly record struct PixelRect(int X, int Y, int Width, int Height);
// 将任意方向的拖动规范化为虚拟桌面内的有效矩形。
public static class CaptureGeometry
{
    // 保留负坐标，并将选区裁剪到给定桌面边界。
    public static PixelRect Selection(int x1, int y1, int x2, int y2, PixelRect bounds)
    {
        var left = Math.Clamp(Math.Min(x1, x2), bounds.X, bounds.X + bounds.Width);
        var top = Math.Clamp(Math.Min(y1, y2), bounds.Y, bounds.Y + bounds.Height);
        var right = Math.Clamp(Math.Max(x1, x2), bounds.X, bounds.X + bounds.Width);
        var bottom = Math.Clamp(Math.Max(y1, y2), bounds.Y, bounds.Y + bounds.Height);
        return new(left, top, right - left, bottom - top);
    }
}
