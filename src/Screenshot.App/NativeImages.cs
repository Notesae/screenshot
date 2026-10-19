using System;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

namespace Screenshot.App;
// 编辑器可接收的图片快照；数据固定为本地 PNG，不包含文件系统访问能力。
public sealed record LoadedImage(string DataUrl, string Name, int Width, int Height);
// 负责原生图片和项目文件的读写、剪贴板交换以及跨桥数据校验。
public static class NativeImages
{
    // 通过用户选择导入图片，将解码后的首帧转换为受限 PNG 快照。
    public static LoadedImage? Open(Window owner)
    {
        var dialog = new OpenFileDialog { Filter = "图片|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff", CheckFileExists = true };
        if (dialog.ShowDialog(owner) != true) return null;
        if (new FileInfo(dialog.FileName).Length > BridgePolicy.MaxDocumentBytes) throw new InvalidOperationException("图片文件超过 64 MB 限制。");
        using var stream = File.OpenRead(dialog.FileName);
        return FromBitmap(ReadBitmap(stream), Path.GetFileName(dialog.FileName));
    }
    public static LoadedImage? Paste()
    {
        var bitmap = Clipboard.GetImage();
        return bitmap is null ? null : FromBitmap(bitmap, "剪贴板.png");
    }
    // 按原像素尺寸编码 PNG，并限制跨桥传输的数据体积。
    public static LoadedImage FromBitmap(BitmapSource bitmap, string name)
    {
        ValidateDimensions(bitmap);
        using var stream = new MemoryStream();
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        encoder.Save(stream);
        if (stream.Length > BridgePolicy.MaxDocumentBytes) throw new InvalidOperationException("图片数据过大。");
        return new("data:image/png;base64," + Convert.ToBase64String(stream.ToArray()), name, bitmap.PixelWidth, bitmap.PixelHeight);
    }
    // 仅解码有正确签名的 PNG data URL，拒绝外链和超大数据。
    public static BitmapSource DecodePng(string dataUrl)
    {
        const string prefix = "data:image/png;base64,";
        if (!dataUrl.StartsWith(prefix, StringComparison.Ordinal) || dataUrl.Length > BridgePolicy.MaxDocumentBytes * 4L / 3 + 64)
            throw new InvalidOperationException("仅支持有效的本地 PNG 图片，最大 64 MB。");
        var bytes = Convert.FromBase64String(dataUrl[prefix.Length..]);
        if (bytes.Length < 8 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) throw new InvalidOperationException("PNG 文件头无效。");
        using var stream = new MemoryStream(bytes);
        return ReadBitmap(stream);
    }
    // 完整加载并冻结图片，使调用方关闭源文件后仍可安全使用像素。
    private static BitmapSource ReadBitmap(Stream stream)
    {
        var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        var frame = decoder.Frames[0];
        ValidateDimensions(frame);
        frame.Freeze();
        return frame;
    }
    private static void ValidateDimensions(BitmapSource source)
    {
        if (source.PixelWidth <= 0 || source.PixelHeight <= 0 || source.PixelWidth > 32768 || source.PixelHeight > 32768 || (long)source.PixelWidth * source.PixelHeight > 100_000_000)
            throw new InvalidOperationException("图片尺寸超过限制（最多一亿像素）。");
    }
    // 用户确认保存位置后重新编码 PNG；取消操作返回 saved:false。
    public static object Save(Window owner, string dataUrl, string? suggestedName)
    {
        var bitmap = DecodePng(dataUrl);
        var dialog = new SaveFileDialog { Filter = "PNG 图片|*.png", DefaultExt = ".png", AddExtension = true, FileName = BridgePolicy.SafeName(suggestedName, "截图.png") };
        if (dialog.ShowDialog(owner) != true) return new { saved = false };
        using var output = File.Create(dialog.FileName);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap)); encoder.Save(output);
        return new { saved = true, path = dialog.FileName };
    }
    public static object Copy(string dataUrl) { Clipboard.SetImage(DecodePng(dataUrl)); return new { copied = true }; }
    // 读取有大小及深度限制的项目 JSON，校验后复制数据供编辑器恢复。
    public static object? OpenProject(Window owner)
    {
        var dialog = new OpenFileDialog { Filter = "Screenshot 项目|*.screenshot.json|JSON|*.json" };
        if (dialog.ShowDialog(owner) != true) return null;
        if (new FileInfo(dialog.FileName).Length > BridgePolicy.MaxDocumentBytes) throw new InvalidOperationException("项目文件超过 64 MB 限制。");
        using var document = JsonDocument.Parse(File.ReadAllText(dialog.FileName), new JsonDocumentOptions { MaxDepth = 64 });
        ValidateProject(document.RootElement);
        return new { name = Path.GetFileName(dialog.FileName), document = document.RootElement.Clone() };
    }
    // 校验项目结构和嵌入图片后，通过原生保存对话框写入 JSON。
    public static object SaveProject(Window owner, JsonElement document, string? name)
    {
        ValidateProject(document);
        var json = document.GetRawText();
        if (System.Text.Encoding.UTF8.GetByteCount(json) > BridgePolicy.MaxDocumentBytes) throw new InvalidOperationException("项目文件超过 64 MB 限制。");
        var dialog = new SaveFileDialog { Filter = "Screenshot 项目|*.screenshot.json", DefaultExt = ".screenshot.json", AddExtension = true, FileName = BridgePolicy.SafeName(name, "截图.screenshot.json") };
        if (dialog.ShowDialog(owner) != true) return new { saved = false };
        File.WriteAllText(dialog.FileName, json);
        return new { saved = true, path = dialog.FileName };
    }
    // 原生边界校验版本、编辑状态和图片来源；具体编辑参数仍由编辑器校验。
    internal static void ValidateProject(JsonElement document)
    {
        if (document.ValueKind != JsonValueKind.Object || !document.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32(out var number) || number is not (1 or 2) || !document.TryGetProperty("editor", out var editor) || editor.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("不支持的项目格式或版本。");
        if (!document.TryGetProperty("image", out var image)) throw new InvalidOperationException("项目缺少图片字段。");
        if (image.ValueKind == JsonValueKind.Null) return;
        if (image.ValueKind != JsonValueKind.Object || !image.TryGetProperty("dataUrl", out var url) || url.ValueKind != JsonValueKind.String) throw new InvalidOperationException("项目图片格式无效。");
        DecodePng(url.GetString()!);
    }
}
