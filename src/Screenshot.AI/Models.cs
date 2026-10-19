namespace Screenshot.AI;

/// <summary>允许返回前端的服务信息，仅表明是否保存密钥。</summary>
public sealed record PublicProvider(string Id, string Name, string Kind, string Model, string BaseUrl, bool HasApiKey, string Revision = "");
/// <summary>公开服务列表及默认服务标识。</summary>
public sealed record PublicSettings(IReadOnlyList<PublicProvider> Providers, string? DefaultProviderId);
/// <summary>OCR 和翻译共用的纯文字响应。</summary>
public sealed record AiTextResult(string Text, AiUsage? Usage = null, bool Cached = false);
/// <summary>仅记录服务返回的 token 数量；缺失不推算、不换算为费用。</summary>
public sealed record AiUsage(long? InputTokens, long? OutputTokens);
/// <summary>有界内存中的调用摘要；不包含图片、正文、译文、地址或密钥。</summary>
public sealed record AiUsageEntry(DateTimeOffset AtUtc,string Operation,bool Cached,AiUsage? Usage,string? ErrorCode);
/// <summary>原生配置窗口提交的修改；密钥留空保留，清除需显式指定。</summary>
public sealed record ProviderUpdate(string Id, string Name, string Kind, string BaseUrl, string Model,
    string? ApiKey = null, bool ClearApiKey = false, bool MakeDefault = true);

/// <summary>可安全显示给用户的服务错误，携带稳定错误码且不附加敏感底层异常。</summary>
public sealed class AiProviderException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

// 仅供原生存储使用；ProtectedApiKey 为 DPAPI 密文。
internal sealed record StoredProvider(string Id, string Name, string Kind, string Model, string BaseUrl, string? ProtectedApiKey);
// 本地持久化结构，不直接用于原生桥返回值。
internal sealed record StoredSettings(List<StoredProvider> Providers, string? DefaultProviderId);
