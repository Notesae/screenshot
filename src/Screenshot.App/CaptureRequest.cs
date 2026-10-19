using System;
using System.Globalization;
using System.Text.Json;

namespace Screenshot.App;

// 捕获错误使用稳定代码，调用方可区分权限、超时、取消和几何变化。
public sealed class CaptureException(string code, string message, Exception? inner = null) : Exception(message, inner)
{
    public string Code { get; } = code;
}

// 请求可指向整个虚拟桌面、一个显示器或一个显式窗口，不包含自动窗口枚举。
public enum CaptureTargetKind { Desktop, Monitor, Window }
// 句柄仅在原生进程使用；桥中以十六进制字符串传入，避免 JavaScript 整数精度损失。
public sealed record CaptureTarget(CaptureTargetKind Kind, nint Handle = 0, bool ClientArea = false);

// WGC 为主后端；只有调用方显式选择 gdi 时才进入兼容捕获，不做隐式降级。
public sealed record CaptureRequest(string Backend, CaptureTarget Target, bool Region, int TimeoutMs = 8000)
{
    public bool SnapWindows { get; init; } = true;
    public bool SnapClientArea { get; init; }
    public const string DefaultBackend = "wgc";
    public static CaptureRequest Default(bool region) => new(DefaultBackend, new(CaptureTargetKind.Desktop), region);

    // 将桥载荷校验为有界、可执行的捕获请求，不接受未知后端或模糊窗口句柄。
    public static CaptureRequest Parse(JsonElement payload, bool region)
    {
        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) return Default(region);
        if (payload.ValueKind != JsonValueKind.Object) throw new CaptureException("invalid_capture_request", "截图参数必须是对象。");
        var backend = ReadString(payload, "backend") ?? DefaultBackend;
        if (backend is not ("wgc" or "gdi")) throw new CaptureException("invalid_capture_backend", "仅支持 WGC 或显式 GDI 兼容后端。");
        var timeout = 8000;
        if (payload.TryGetProperty("timeoutMs", out var timeoutValue)
            && (timeoutValue.ValueKind != JsonValueKind.Number || !timeoutValue.TryGetInt32(out timeout) || timeout < 100 || timeout > 30000))
            throw new CaptureException("invalid_capture_timeout", "捕获超时须为 100 至 30000 毫秒。");
        var target = new CaptureTarget(CaptureTargetKind.Desktop);
        if (payload.TryGetProperty("target", out var value))
        {
            if (value.ValueKind != JsonValueKind.Object) throw new CaptureException("invalid_capture_target", "截图目标必须是对象。");
            var kind = ReadString(value, "kind") ?? "desktop";
            var area = ReadString(value, "area") ?? "window";
            if (area is not ("window" or "client")) throw new CaptureException("invalid_capture_target", "窗口区域仅支持 window 或 client。");
            target = kind switch
            {
                "desktop" => new(CaptureTargetKind.Desktop),
                "monitor" => new(CaptureTargetKind.Monitor, ParseHandle(ReadString(value, "handle"))),
                "window" => new(CaptureTargetKind.Window, ParseHandle(ReadString(value, "handle")), area == "client"),
                _ => throw new CaptureException("invalid_capture_target", "不支持的截图目标。")
            };
        }
        var snap=true;if(payload.TryGetProperty("snapWindows",out var snapValue)){if(snapValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw new CaptureException("invalid_capture_request","窗口吸附参数无效。");snap=snapValue.GetBoolean();}
        var snapArea=ReadString(payload,"windowArea")??"window";if(snapArea is not ("window" or "client"))throw new CaptureException("invalid_capture_request","请选择窗口或客户区。");
        return new(backend, target, region, timeout){SnapWindows=snap,SnapClientArea=snapArea=="client"};
    }

    private static string? ReadString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var item)) return null;
        if (item.ValueKind != JsonValueKind.String) throw new CaptureException("invalid_capture_request", "截图字段格式无效：" + name);
        return item.GetString();
    }

    // 目标句柄必须是非零正值，拒绝符号溢出和精度不确定的 JSON 数字。
    private static nint ParseHandle(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 20) throw new CaptureException("invalid_capture_target", "请提供有效的原生目标句柄字符串。");
        var hex = text.StartsWith("0x", StringComparison.OrdinalIgnoreCase);
        if (!ulong.TryParse(hex ? text[2..] : text, hex ? NumberStyles.AllowHexSpecifier : NumberStyles.None, CultureInfo.InvariantCulture, out var handle)
            || handle == 0 || handle > (ulong)(IntPtr.Size == 8 ? long.MaxValue : int.MaxValue))
            throw new CaptureException("invalid_capture_target", "目标句柄无效或超出本机范围。");
        return (nint)(long)handle;
    }
}
