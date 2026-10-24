using System;
using System.Buffers.Text;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
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
    private const string PngPrefix = "data:image/png;base64,";
    private static readonly object PngValidationLock = new();
    // 仅保留最近四个已成功解码的 SHA-256，不让校验缓存挂住 Base64、PNG 字节或位图。
    private static readonly LinkedList<byte[]> ValidatedPngs = new();
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
        // PNG 已在流中，直接读取有效区，避免再复制一份完整数组。
        return new(PngPrefix + Convert.ToBase64String(stream.GetBuffer(), 0, checked((int)stream.Length)), name, bitmap.PixelWidth, bitmap.PixelHeight);
    }
    // 仅解码有正确签名的 PNG data URL，拒绝外链和超大数据。
    public static BitmapSource DecodePng(string dataUrl)
    {
        var bitmap = DecodePngCore(dataUrl);
        UsePngValidation(PngFingerprint(dataUrl), remember: true);
        return bitmap;
    }
    private static BitmapSource DecodePngCore(string dataUrl)
    {
        using var stream = new MemoryStream(ReadPngBytes(dataUrl), writable: false);
        return ReadBitmap(stream);
    }
    private static byte[] PngFingerprint(string dataUrl) => SHA256.HashData(MemoryMarshal.AsBytes(dataUrl.AsSpan()));
    // 内容相同才复用既有像素校验；不同输入仍完整检查编码、签名、解码及尺寸。
    private static void ValidatePng(string dataUrl)
    {
        ValidatePngEnvelope(dataUrl, BridgePolicy.MaxDocumentBytes);
        var fingerprint = PngFingerprint(dataUrl);
        if (UsePngValidation(fingerprint, remember: false)) return;
        DecodePngCore(dataUrl);
        UsePngValidation(fingerprint, remember: true);
    }
    // 短锁内仅维护四项 LRU；哈希和图片解码都在锁外执行。
    private static bool UsePngValidation(byte[] fingerprint, bool remember)
    {
        lock (PngValidationLock)
        {
            for (var node = ValidatedPngs.First; node is not null; node = node.Next)
            {
                if (!CryptographicOperations.FixedTimeEquals(node.Value, fingerprint)) continue;
                ValidatedPngs.Remove(node); ValidatedPngs.AddLast(node);
                return true;
            }
            if (remember)
            {
                ValidatedPngs.AddLast(fingerprint);
                if (ValidatedPngs.Count > 4) ValidatedPngs.RemoveFirst();
            }
            return false;
        }
    }
    private static void ValidatePngEnvelope(string dataUrl, int maxBytes)
    {
        if (!dataUrl.StartsWith(PngPrefix, StringComparison.Ordinal) || dataUrl.Length > maxBytes * 4L / 3 + 64)
            throw new InvalidOperationException("仅支持有效的本地 PNG 图片，最大 64 MB。");
    }
    // 无分配校验取得精确长度，再从原字符串的区间解码，保留 PNG 和体积边界。
    internal static byte[] ReadPngBytes(string dataUrl, int maxBytes = BridgePolicy.MaxDocumentBytes)
    {
        ValidatePngEnvelope(dataUrl, maxBytes);
        var encoded = dataUrl.AsSpan(PngPrefix.Length);
        if (!Base64.IsValid(encoded, out var length)) throw new FormatException("PNG 图片编码无效。");
        if (length > maxBytes) throw new InvalidOperationException("图片数据过大。");
        var bytes = new byte[length];
        if (!Convert.TryFromBase64Chars(encoded, bytes, out var written) || written != length) throw new FormatException("PNG 图片编码无效。");
        if (bytes.Length < 8 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) throw new InvalidOperationException("PNG 文件头无效。");
        return bytes;
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
    // 完整解码校验后保存现有 PNG，不重复编码；取消操作仍不创建文件。
    public static object Save(Window owner, string dataUrl, string? suggestedName)
    {
        var png = ReadPngBytes(dataUrl);
        using (var input = new MemoryStream(png, writable: false)) ReadBitmap(input);
        var dialog = new SaveFileDialog { Filter = "PNG 图片|*.png", DefaultExt = ".png", AddExtension = true, FileName = BridgePolicy.SafeName(suggestedName, "截图.png") };
        if (dialog.ShowDialog(owner) != true) return new { saved = false };
        using var output = File.Create(dialog.FileName);
        output.Write(png);
        return new { saved = true, path = dialog.FileName };
    }
    // 文字输出是明确操作，只写剪贴板，不读取用户现有内容。
    public static object CopyText(string text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > 100_000) throw new InvalidOperationException("复制文字不能为空，且最多100000字符。");
        Clipboard.SetText(text); return new { copied = true };
    }
    // 保留同步入口；主界面使用后台准备及显式 STA 提交，不让 WPF 自动转换后台解码对象。
    public static object Copy(string dataUrl)
    {
        var image = PrepareClipboardImage(dataUrl); image.Write();
        if (image.Confirm() != ClipboardImageStatus.Ready) throw new IOException("图片未能可靠写入剪贴板，已保留当前编辑，请重试。");
        return new { copied = true };
    }
    internal static ClipboardImagePayload PrepareClipboardImage(string dataUrl)
    {
        var png = ReadPngBytes(dataUrl);
        using var stream = new MemoryStream(png, writable: false);
        var image = new ClipboardImagePayload(png, ReadBitmap(stream));
        UsePngValidation(PngFingerprint(dataUrl), remember: true);
        return image;
    }
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
        ValidatePng(url.GetString()!);
    }
}
