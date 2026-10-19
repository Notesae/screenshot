using System.Buffers;
using System.Buffers.Binary;
using System.Buffers.Text;
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
    private const string Prefix = "data:image/png;base64,";

    // 只接受项目 schema 1/2 与本地 PNG；不请求远程 URL，也不改变原图字节。
    internal static PreparedSnapshot Prepare(JsonElement document, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (document.ValueKind != JsonValueKind.Object) throw Invalid();
        // 先流式剔除dataUrl再解析小型元数据，避免把数十MB原图转成JSON字符串、JsonNode后再删除。
        var root = ParseRoot(MetadataJson(document));
        byte[]? image = null; string? hash = null; string name = "截图";
        if (root["image"] is JsonObject imageNode)
        {
            var source=document.GetProperty("image");
            if(!source.TryGetProperty("dataUrl",out var value)||value.ValueKind!=JsonValueKind.String)throw Invalid();
            var dataUrl=value.GetString();
            if(dataUrl is null||!dataUrl.StartsWith(Prefix,StringComparison.Ordinal))throw Invalid();
            if (dataUrl.Length > Prefix.Length + (MaxImageBytes + 2L) / 3 * 4)
                throw new SnapshotStoreException("asset_too_large", "恢复原图不能超过 20 MB。");
            var encoded=dataUrl.AsSpan(Prefix.Length);var trimmed=encoded.TrimEnd();
            var padding=trimmed.EndsWith("==")?2:trimmed.EndsWith("=")?1:0;
            image=new byte[Math.Max(0,(encoded.Length+3)/4*3-padding)];
            if(!Convert.TryFromBase64Chars(encoded,image,out var written))throw Invalid();
            // 兼容合法Base64中的空白；常见无空白输入无需复制整图子串或再次分配。
            if(written!=image.Length)Array.Resize(ref image,written);
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

    // 有界写入会在超额元数据进入内存前停止；未知元数据继续保留，顶层/图像重名字段拒绝。
    private static string MetadataJson(JsonElement document)
    {
        using var output=new MetadataBuffer();using(var writer=new Utf8JsonWriter(output)){
            writer.WriteStartObject();var names=new HashSet<string>(StringComparer.Ordinal);
            foreach(var property in document.EnumerateObject()){
                if(!names.Add(property.Name))throw Invalid();writer.WritePropertyName(property.Name);
                if(property.Name!="image"||property.Value.ValueKind!=JsonValueKind.Object){property.Value.WriteTo(writer);continue;}
                writer.WriteStartObject();var imageNames=new HashSet<string>(StringComparer.Ordinal);
                foreach(var field in property.Value.EnumerateObject()){
                    if(!imageNames.Add(field.Name))throw Invalid();if(field.Name=="dataUrl")continue;
                    field.WriteTo(writer);
                }
                writer.WriteEndObject();
            }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(output.GetBuffer(),0,checked((int)output.Length));
    }
    private sealed class MetadataBuffer:MemoryStream
    {
        private void Limit(int count){if(Length+count>MaxJsonBytes)throw new SnapshotStoreException("document_too_large","恢复文档文字或标注过多，请减少内容后重试。");}
        public override void Write(byte[] buffer,int offset,int count){Limit(count);base.Write(buffer,offset,count);}
        public override void Write(ReadOnlySpan<byte> buffer){Limit(buffer.Length);base.Write(buffer);}
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
        }
        else if (root["image"] is not null || image is not null) throw Corrupt();
        // Base64为本方法生成的ASCII，不经大字符串最坏6倍转义缓冲；不把图像内容拼进可执行HTML。
        byte[]? encoded=null;
        if(image is not null){
            var prefix=Encoding.ASCII.GetBytes("\""+Prefix);encoded=new byte[prefix.Length+Base64.GetMaxEncodedToUtf8Length(image.Length)+1];prefix.CopyTo(encoded,0);
            if(Base64.EncodeToUtf8(image,encoded.AsSpan(prefix.Length),out var consumed,out var written)!=OperationStatus.Done||consumed!=image.Length)throw Corrupt();
            encoded[prefix.Length+written]=(byte)'"';
        }
        using var output=new MemoryStream(checked(Encoding.UTF8.GetByteCount(json)+(encoded?.Length??0)+32));
        using(var writer=new Utf8JsonWriter(output)){
            writer.WriteStartObject();foreach(var property in root){
                writer.WritePropertyName(property.Key);
                if(property.Key=="image"&&property.Value is JsonObject metadata&&encoded is not null){
                    writer.WriteStartObject();foreach(var field in metadata){writer.WritePropertyName(field.Key);if(field.Value is null)writer.WriteNullValue();else field.Value.WriteTo(writer);}
                    writer.WritePropertyName("dataUrl");writer.WriteRawValue(encoded,skipInputValidation:true);writer.WriteEndObject();
                }else if(property.Value is null)writer.WriteNullValue();else property.Value.WriteTo(writer);
            }writer.WriteEndObject();
        }
        using var parsed=JsonDocument.Parse(output.GetBuffer().AsMemory(0,checked((int)output.Length)),new JsonDocumentOptions{MaxDepth=64});
        return parsed.RootElement.Clone();
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
