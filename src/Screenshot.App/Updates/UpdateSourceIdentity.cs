using System;
using System.Text.Json;

namespace Screenshot.App.Updates;

// 仅受控错误码与中文说明；不保留 HTTP 正文、请求或内部网络异常。
internal sealed class UpdateSourceException(string code, string message) : Exception(message)
{ internal string Code { get; } = code; }

internal static class GitHubUpdateIdentity
{
    internal const string Repository = "Notesae/screenshot";
    internal const long RepositoryId = 1425162253;
    // 名称与不可变 ID 同时匹配；仓库再次变为私有或转移时失败关闭，不转入登录流程。
    internal static void VerifyRepository(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var value) || value != RepositoryId
            || !root.TryGetProperty("full_name", out var name) || name.ValueKind != JsonValueKind.String || !string.Equals(name.GetString(), Repository, StringComparison.OrdinalIgnoreCase)
            || !root.TryGetProperty("private", out var privateValue) || privateValue.ValueKind != JsonValueKind.False
            || root.TryGetProperty("visibility", out var visibility) && (visibility.ValueKind != JsonValueKind.String || visibility.GetString() != "public"))
            throw new UpdateSourceException("repository_mismatch", "官方更新仓库身份或公开状态不符，已停止。请联系发布者；不会请求登录或切换来源。");
    }
}
