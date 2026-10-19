using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Screenshot.Storage;

/// <summary>验证项目与本地 PNG，将原图从 JSON 分离，并在恢复时重新组装。</summary>
internal static class SnapshotDocumentCodec
{
    internal const int MaxImageBytes = 20 * 1024 * 1024;
    internal const int MaxJsonBytes = 4 * 1024 * 1024;
    private const int MaxEnvelopeCharacters = 32 * 1024 * 1024;
    private const string Prefix = "data:image/png;base64,";

    // 只接受项目 schema 1/2 与本地 PNG；不请求远程 URL，也不改变原图字节。
    internal static PreparedSnapshot Prepare(JsonElement document, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (document.ValueKind != JsonValueKind.Object) throw Invalid();
        string raw = document.GetRawText();
        if (raw.Length > MaxEnvelopeCharacters) throw new SnapshotStoreException("document_too_large", "恢复文档过大，请减少内容后重试。");
        var root = ParseRoot(raw);
        byte[]? image = null; string? hash = null; string name = "截图";
        if (root["image"] is JsonObject imageNode)
        {
            if (imageNode["dataUrl"] is not JsonValue value || !value.TryGetValue<string>(out var dataUrl)
                || dataUrl is null || !dataUrl.StartsWith(Prefix, StringComparison.Ordinal)) throw Invalid();
            if (dataUrl.Length > Prefix.Length + (MaxImageBytes + 2L) / 3 * 4)
                throw new SnapshotStoreException("asset_too_large", "恢复原图不能超过 20 MB。");
            try { image = Convert.FromBase64String(dataUrl[Prefix.Length..]); }
            catch (FormatException) { throw Invalid(); }
            token.ThrowIfCancellationRequested();
            ValidatePng(image, imageNode);
            hash = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
            name = SafeName(imageNode["name"]);
            imageNode.Remove("dataUrl");
        }
        else if (root["image"] is not null) throw Invalid();
        var json = root.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) > MaxJsonBytes)
            throw new SnapshotStoreException("document_too_large", "恢复文档文字或标注过多，请减少内容后重试。");
        return new(json, name, image, hash);
    }

    // 数据库内容也重新验证，禁止用损坏字段引入外部来源或替换资产引用。
    internal static JsonElement Restore(string json, byte[]? image)
    {
        if (Encoding.UTF8.GetByteCount(json) > MaxJsonBytes) throw Corrupt();
        JsonObject root;
        try { root = ParseRoot(json); }
        catch (SnapshotStoreException) { throw Corrupt(); }
        if (root["image"] is JsonObject imageNode)
        {
            if (image is null || imageNode.ContainsKey("dataUrl")) throw Corrupt();
            try { ValidatePng(image, imageNode); }
            catch (SnapshotStoreException) { throw Corrupt(); }
            imageNode["dataUrl"] = Prefix + Convert.ToBase64String(image);
        }
        else if (root["image"] is not null || image is not null) throw Corrupt();
        return JsonSerializer.SerializeToElement(root);
    }

    // 保留编辑器字段供版本校验；只在这里限定顶层结构及已支持的版本。
    private static JsonObject ParseRoot(string json)
    {
        try
        {
            var root = JsonNode.Parse(json, documentOptions: new JsonDocumentOptions { MaxDepth = 64 }) as JsonObject;
            if (root is null || root["schemaVersion"] is not JsonValue version || !version.TryGetValue<int>(out int number)
                || number is not (1 or 2) || !root.ContainsKey("image") || root["editor"] is not JsonObject) throw Invalid();
            return root;
        }
        catch (JsonException) { throw Invalid(); }
        catch (ArgumentException) { throw Invalid(); }
    }

    // 读取固定 IHDR，确认图片元数据与原图一致；压缩流不在存储层解码。
    private static void ValidatePng(byte[] image, JsonObject node)
    {
        if (image.Length < 33 || image.Length > MaxImageBytes
            || !image.AsSpan(0,8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10})
            || BinaryPrimitives.ReadUInt32BigEndian(image.AsSpan(8,4)) != 13 || !image.AsSpan(12,4).SequenceEqual("IHDR"u8)) throw Invalid();
        int width = BinaryPrimitives.ReadInt32BigEndian(image.AsSpan(16,4));
        int height = BinaryPrimitives.ReadInt32BigEndian(image.AsSpan(20,4));
        if (width <= 0 || height <= 0 || width > 16000 || height > 16000 || (long)width * height > 64_000_000
            || node["width"] is not JsonValue w || !w.TryGetValue<int>(out int declaredWidth) || declaredWidth != width
            || node["height"] is not JsonValue h || !h.TryGetValue<int>(out int declaredHeight) || declaredHeight != height) throw Invalid();
    }

    // 列表名称移除目录及控制字符，避免恢复列表暴露完整本地路径。
    private static string SafeName(JsonNode? node)
    {
        if (node is not JsonValue value || !value.TryGetValue<string>(out var raw) || string.IsNullOrWhiteSpace(raw)) return "截图";
        var name = raw.Replace('\\','/').Split('/').Last();
        name = string.Concat(name.Where(c => !char.IsControl(c))).Trim();
        if (name.Length > 80) name = name[..80];
        return name.Length == 0 ? "截图" : name;
    }

    private static SnapshotStoreException Invalid() => new("invalid_document", "恢复文档格式无效，仅支持 schema 1/2 与有效的本地 PNG 原图。");
    private static SnapshotStoreException Corrupt() => new("snapshot_corrupt", "恢复文档或原图已损坏，无法安全恢复。");
}
