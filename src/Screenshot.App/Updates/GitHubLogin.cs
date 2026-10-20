using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App.Updates;

internal sealed record GitHubLoginStatus(string State, string Message, string? Account = null, DateTimeOffset? ExpiresAt = null);
internal sealed record GitHubDevicePrompt(string UserCode, Uri VerificationUri, DateTimeOffset ExpiresAt);
internal enum GitHubLoginPhase { Request, DeviceCode, TokenExchange, VerifyAccess }
// 错误只保留受控代码和中文说明，不保留服务器正文、请求、令牌或内部异常。
internal sealed class GitHubLoginException(string code, string message) : Exception(message)
{
    internal string Code { get; } = code;
    // 阶段来自本机固定枚举，不能把服务器内容带入诊断。
    internal GitHubLoginPhase Phase { get; set; } = GitHubLoginPhase.Request;
}

internal static class GitHubUpdateIdentity
{
    internal const string Repository = "Notesae/screenshot";
    internal const long RepositoryId = 1425162253;
    internal static string ClientId(Assembly assembly) => assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "GitHubUpdateClientId")?.Value ?? "";
    internal static bool IsApiResource(Uri u) => u.Scheme == "https" && u.Host == "api.github.com" && u.IsDefaultPort && u.UserInfo == "" && u.Fragment == ""
        && (u.AbsolutePath == "/user" || Regex.IsMatch(u.AbsolutePath, @"^/user/installations(?:/[1-9]\d*/repositories)?$", RegexOptions.CultureInvariant) || Regex.IsMatch(u.AbsolutePath, @"^/repos/Notesae/screenshot(?:/releases(?:/assets/[1-9]\d*)?)?$", RegexOptions.CultureInvariant));
    internal static void VerifyRepository(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var value) || value != RepositoryId
            || !root.TryGetProperty("full_name", out var name) || name.ValueKind != JsonValueKind.String || !string.Equals(name.GetString(), Repository, StringComparison.OrdinalIgnoreCase))
            throw new GitHubLoginException("repository_mismatch", "更新源仓库身份不匹配，已拒绝访问。请联系发布者。");
    }
}

// 令牌仅作为不带 ToString 数据展开的内部对象持有；每次请求授权，禁止放入默认 HTTP 头。
internal sealed class GitHubAuthLease : IDisposable
{
    private readonly string _access;
    private readonly CancellationTokenSource _cancellation;
    internal long Epoch { get; }
    internal long Version { get; }
    internal CancellationToken Token => _cancellation.Token;
    internal GitHubAuthLease(string access, long epoch, long version, CancellationToken session, CancellationToken operation)
    { _access = access; Epoch = epoch; Version = version; _cancellation = CancellationTokenSource.CreateLinkedTokenSource(session, operation); }
    internal void Authorize(HttpRequestMessage request)
    {
        Token.ThrowIfCancellationRequested();
        if (request.Method != HttpMethod.Get || request.RequestUri is not { } uri || !GitHubUpdateIdentity.IsApiResource(uri))
            throw new GitHubLoginException("unsafe_auth_target", "已拒绝向非官方仓库 API 发送登录信息。");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _access);
    }
    public void Dispose() => _cancellation.Dispose();
}

// 一个主窗口持有一个进程内会话；关闭设置只取消操作，退出登录/应用才清除会话。
internal sealed class GitHubLogin : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _clientId;
    private readonly Func<DateTimeOffset> _now;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _sync = new();
    private CancellationTokenSource _session = new();
    private Credentials? _credentials;
    private long _epoch, _version;
    private bool _disposed;
    private GitHubLoginStatus _status = new("signed-out", "尚未登录。登录只访问官方 GitHub，不发送截图或服务商配置。");
    // 使用普通类而非 record，防止调试或异常字符串自动展开秘密字段。
    private sealed class Credentials(string access, string? refresh, DateTimeOffset expires, DateTimeOffset refreshExpires, string account)
    { internal readonly string Access = access; internal readonly string? Refresh = refresh; internal readonly DateTimeOffset Expires = expires, RefreshExpires = refreshExpires; internal readonly string Account = account; }
    internal bool IsConfigured => Regex.IsMatch(_clientId, "^Iv[A-Za-z0-9._-]{6,96}$", RegexOptions.CultureInvariant);
    internal bool HasSession { get { lock (_sync) return _credentials is not null; } }
    internal GitHubLoginStatus Status
    {
        get
        {
            lock (_sync)
            {
                if (!IsConfigured) return new("unconfigured", "发布者尚未配置官方 GitHub App Client ID（非秘密）。登录和私有更新均未启用；请等待发布者提供已配置版本。");
                if (_credentials is { } c && c.Expires <= _now()) return new("expired", "当前登录已过期；手动检查时将尝试刷新，或重新登录。", c.Account, c.Expires);
                return _status;
            }
        }
    }
    internal GitHubLogin(string clientId) : this(clientId, new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, Credentials = null })) { }
    internal GitHubLogin(string clientId, HttpClient http, Func<DateTimeOffset>? now = null, Func<TimeSpan, CancellationToken, Task>? delay = null)
    { _clientId = clientId.Trim(); _http = http; _http.Timeout = TimeSpan.FromSeconds(30); _now = now ?? (() => DateTimeOffset.UtcNow); _delay = delay ?? ((time, token) => Task.Delay(time, token)); }

    // 获取短码后等待用户亲自批准；只在验证账号、仓库身份和 Contents 读取成功后提交内存会话。
    internal async Task LoginAsync(IProgress<GitHubDevicePrompt> progress, CancellationToken cancellation)
    {
        RequireConfigured(); cancellation.ThrowIfCancellationRequested();
        if (!await _gate.WaitAsync(0, cancellation)) throw new GitHubLoginException("login_busy", "已有登录或刷新请求，请先取消或等待完成。");
        long epoch;
        CancellationToken session;
        lock (_sync)
        {
            Reset(); epoch = _epoch; session = _session.Token;
            _status = new("waiting", "正在向 GitHub 请求设备码…");
        }
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, session);
        var token = linked.Token;
        var phase = GitHubLoginPhase.DeviceCode;
        try
        {
            using var device = await PostAsync("device/code", new() { ["client_id"] = _clientId, ["scope"] = "offline_access" }, token);
            var root = device.RootElement;
            if (ReadOAuthError(root) is { } deviceError) throw OAuthError(deviceError);
            var code = ReadString(root, "device_code", 200); var userCode = ReadString(root, "user_code", 20);
            if (!Regex.IsMatch(code, "^[A-Za-z0-9_-]{20,200}$") || !Regex.IsMatch(userCode, "^[A-Z0-9]{4}-[A-Z0-9]{4}$")
                || ReadString(root, "verification_uri", 100) != "https://github.com/login/device") throw InvalidResponse();
            var expires = _now().AddSeconds(ReadSeconds(root, "expires_in", 900));
            var interval = Math.Max(5, ReadSeconds(root, "interval", 60));
            token.ThrowIfCancellationRequested();
            SetStatus(epoch, new("waiting", "请在 GitHub 官方页面输入下方设备码；本程序不会自动授权。"));
            progress.Report(new(userCode, new("https://github.com/login/device"), expires));
            while (_now() < expires)
            {
                await _delay(TimeSpan.FromSeconds(interval), token); token.ThrowIfCancellationRequested();
                if (_now() >= expires) break;
                phase = GitHubLoginPhase.TokenExchange;
                using var poll = await PostAsync("oauth/access_token", new()
                {
                    ["client_id"] = _clientId, ["device_code"] = code,
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                    ["repository_id"] = GitHubUpdateIdentity.RepositoryId.ToString(System.Globalization.CultureInfo.InvariantCulture)
                }, token);
                token.ThrowIfCancellationRequested();
                if (_now() >= expires) break;
                if (ReadOAuthError(poll.RootElement) is { } error)
                {
                    switch (error)
                    {
                        case "authorization_pending": continue;
                        case "slow_down": interval += 5; SetStatus(epoch, new("waiting", "GitHub 要求放慢请求，正在按官方间隔等待授权。")); continue;
                        case "access_denied": throw new GitHubLoginException("denied", "你已拒绝 GitHub 授权；没有保存登录信息，可重新登录。");
                        case "expired_token": throw new GitHubLoginException("expired", "设备码已过期，请重新登录获取新设备码。");
                        default: throw OAuthError(error);
                    }
                }
                var candidate = ParseCredentials(poll.RootElement, "");
                phase = GitHubLoginPhase.VerifyAccess;
                SetStatus(epoch, new("verifying", "正在核对 GitHub 账号和官方仓库读取权限…"));
                var account = await VerifyAccessAsync(candidate.Access, token);
                token.ThrowIfCancellationRequested();
                lock (_sync)
                {
                    if (epoch != _epoch || _disposed) throw new OperationCanceledException(token);
                    _credentials = new(candidate.Access, candidate.Refresh, candidate.Expires, candidate.RefreshExpires, account); _version++;
                    _status = new("signed-in", "已登录，令牌仅保存在本次应用进程内存中。", account, candidate.Expires);
                }
                return;
            }
            throw new GitHubLoginException("expired", "设备码已过期，请重新登录获取新设备码。");
        }
        catch (OperationCanceledException) { SetStatus(epoch, new("signed-out", "登录已取消，未保留本次登录信息。")); throw; }
        catch (GitHubLoginException e) { e.Phase = phase; SetStatus(epoch, new(e.Code, e.Message)); throw; }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException or KeyNotFoundException)
        { var safe = InvalidResponse(); safe.Phase = phase; SetStatus(epoch, new(safe.Code, safe.Message)); throw safe; }
        finally { _gate.Release(); }
    }

    // 刷新只由明确的检查/下载触发；串行刷新避免并发消费同一个 refresh token。
    internal async Task<GitHubAuthLease> GetLeaseAsync(CancellationToken cancellation)
    {
        RequireConfigured();
        await _gate.WaitAsync(cancellation);
        try
        {
            Credentials current; long epoch; CancellationToken session;
            lock (_sync) { current = _credentials ?? throw new GitHubLoginException("login_required", "请先登录 GitHub，再检查私有更新。"); epoch = _epoch; session = _session.Token; }
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, session);
            if (current.Expires <= _now().AddSeconds(60))
            {
                if (current.Refresh is null || current.RefreshExpires <= _now()) { RejectEpoch(epoch, "登录已过期，请重新登录。"); throw new GitHubLoginException("expired", "登录已过期，请重新登录。"); }
                try
                {
                    using var refresh = await PostAsync("oauth/access_token", new() { ["client_id"] = _clientId, ["grant_type"] = "refresh_token", ["refresh_token"] = current.Refresh }, linked.Token);
                    if (refresh.RootElement.TryGetProperty("error", out _)) { RejectEpoch(epoch, "登录已失效或被撤销，请重新登录。"); throw new GitHubLoginException("expired", "登录已失效或被撤销，请重新登录。"); }
                    var next = ParseCredentials(refresh.RootElement, current.Account); linked.Token.ThrowIfCancellationRequested();
                    lock (_sync) { if (epoch != _epoch || _disposed) throw new OperationCanceledException(linked.Token); _credentials = next; _version++; _status = new("signed-in", "已刷新当前内存会话，未写入磁盘。", next.Account, next.Expires); current = next; }
                }
                catch (GitHubLoginException e) when (e.Code == "bad_credentials") { RejectEpoch(epoch, "登录已失效，请重新登录。"); throw; }
                catch (GitHubLoginException e) when (e.Code == "invalid_response") { RejectEpoch(epoch, e.Message); throw; }
                catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException or KeyNotFoundException)
                { var safe = InvalidResponse(); RejectEpoch(epoch, safe.Message); throw safe; }
            }
            // 每次明确检查/下载前重新核对安装，配置变更后也不能继续使用过宽授权。
            try { await VerifyInstallationAsync(current.Access, linked.Token); }
            catch (GitHubLoginException e) when (e.Code is "permission_scope_mismatch" or "repository_mismatch" or "access_required" or "invalid_response") { RejectEpoch(epoch, e.Message); throw; }
            catch (GitHubLoginException e) when (e.Code == "bad_credentials") { RejectEpoch(epoch, e.Message); throw new GitHubLoginException("expired", "GitHub 登录已失效或被撤销，请重新登录。"); }
            catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException or KeyNotFoundException) { var safe = InvalidResponse(); RejectEpoch(epoch, safe.Message); throw safe; }
            lock (_sync)
            {
                if (epoch != _epoch || _disposed) throw new OperationCanceledException(linked.Token);
                return new(current.Access, epoch, _version, _session.Token, cancellation);
            }
        }
        finally { _gate.Release(); }
    }
    internal void Reject(GitHubAuthLease lease)
    { lock (_sync) { if (lease.Epoch == _epoch && lease.Version == _version) { Reset(); _status = new("expired", "GitHub 登录已失效或被撤销，请重新登录。"); } } }
    private void RejectEpoch(long epoch, string message) { lock (_sync) { if (epoch == _epoch) { Reset(); _status = new("expired", message); } } }
    internal void SignOut() { lock (_sync) { Reset(); _status = new("signed-out", "已退出本机登录并停止相关请求。完整撤销请在 GitHub 授权应用页面操作。"); } }
    private void SetStatus(long epoch, GitHubLoginStatus status) { lock (_sync) { if (_epoch == epoch && !_disposed) _status = status; } }
    private void Reset() { _credentials = null; _epoch++; _session.Cancel(); _session.Dispose(); _session = new(); }
    private void RequireConfigured()
    {
        lock (_sync) { if (_disposed) throw new ObjectDisposedException(nameof(GitHubLogin)); }
        if (!IsConfigured) throw new GitHubLoginException("unconfigured", Status.Message);
    }

    private Credentials ParseCredentials(JsonElement root, string account)
    {
        var access = ReadString(root, "access_token", 512);
        if (!Regex.IsMatch(access, "^ghu_[A-Za-z0-9_-]{20,508}$") || !string.Equals(ReadString(root, "token_type", 20), "bearer", StringComparison.OrdinalIgnoreCase)
            || (root.TryGetProperty("scope", out var scope) && scope.GetString() is not (null or ""))) throw InvalidResponse();
        var expires = _now().AddSeconds(ReadSeconds(root, "expires_in", 28800));
        string? refresh = null; var refreshExpires = _now();
        if (root.TryGetProperty("refresh_token", out var value))
        {
            refresh = value.GetString(); if (refresh is null || !Regex.IsMatch(refresh, "^ghr_[A-Za-z0-9_-]{20,508}$")) throw InvalidResponse();
            refreshExpires = _now().AddSeconds(ReadSeconds(root, "refresh_token_expires_in", 15897600));
        }
        return new(access, refresh, expires, refreshExpires, account);
    }
    // 先读当前 App 的安装元数据；范围过宽时停止，不访问其他仓库或尝试缩减/扩展远端授权。
    private async Task VerifyInstallationAsync(string access, CancellationToken token)
    {
        using var installations = await GetAsync(new("https://api.github.com/user/installations?per_page=100"), access, token);
        var root = installations.RootElement;
        if (root.GetProperty("total_count").GetInt32() != 1 || root.GetProperty("installations").GetArrayLength() != 1) throw ScopeMismatch();
        var installation = root.GetProperty("installations")[0];
        if (ReadString(installation.GetProperty("account"), "login", 39) != "Notesae" || ReadString(installation, "repository_selection", 20) != "selected") throw ScopeMismatch();
        var id = installation.GetProperty("id").GetInt64(); if (id <= 0) throw InvalidResponse();
        var permissions = installation.GetProperty("permissions");
        if (permissions.ValueKind != JsonValueKind.Object) throw InvalidResponse();
        foreach (var permission in permissions.EnumerateObject())
            if (permission.Value.ValueKind != JsonValueKind.String || permission.Value.GetString() != "none" && !(permission.Name is "contents" or "metadata" && permission.Value.GetString() == "read")) throw ScopeMismatch();
        if (ReadString(permissions, "contents", 10) != "read" || ReadString(permissions, "metadata", 10) != "read") throw ScopeMismatch();
        using var repositories = await GetAsync(new($"https://api.github.com/user/installations/{id}/repositories?per_page=100"), access, token);
        var list = repositories.RootElement;
        if (list.GetProperty("total_count").GetInt32() != 1 || list.GetProperty("repositories").GetArrayLength() != 1) throw ScopeMismatch();
        GitHubUpdateIdentity.VerifyRepository(list.GetProperty("repositories")[0]);
    }
    private static GitHubLoginException ScopeMismatch() => new("permission_scope_mismatch", "当前 App 的安装或权限范围不符：仅允许安装到 Notesae/screenshot，Contents 与必要 Metadata 只读。已停止读取版本；请在官方 App 设置核对，不会自动变更权限。");
    private async Task<string> VerifyAccessAsync(string access, CancellationToken token)
    {
        await VerifyInstallationAsync(access, token);
        using var user = await GetAsync(new("https://api.github.com/user"), access, token);
        var login = ReadString(user.RootElement, "login", 39);
        if (!Regex.IsMatch(login, "^[A-Za-z0-9-]{1,39}$") || !user.RootElement.TryGetProperty("id", out var id) || !id.TryGetInt64(out var userId) || userId <= 0) throw InvalidResponse();
        using var repo = await GetAsync(new($"https://api.github.com/repos/{GitHubUpdateIdentity.Repository}"), access, token);
        GitHubUpdateIdentity.VerifyRepository(repo.RootElement);
        using var releases = await GetAsync(new($"https://api.github.com/repos/{GitHubUpdateIdentity.Repository}/releases?per_page=1"), access, token);
        if (releases.RootElement.ValueKind != JsonValueKind.Array) throw InvalidResponse();
        return login;
    }
    private async Task<JsonDocument> PostAsync(string endpoint, Dictionary<string, string> values, CancellationToken token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/" + endpoint) { Content = new FormUrlEncodedContent(values) };
        return await SendJsonAsync(request, 16384, token);
    }
    private async Task<JsonDocument> GetAsync(Uri uri, string access, CancellationToken token)
    {
        if (!GitHubUpdateIdentity.IsApiResource(uri)) throw InvalidResponse();
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        return await SendJsonAsync(request, 4 * 1024 * 1024, token);
    }
    private async Task<JsonDocument> SendJsonAsync(HttpRequestMessage request, int maxBytes, CancellationToken token)
    {
        request.Headers.UserAgent.ParseAdd("Screenshot-Updater/0.4.7"); request.Headers.Accept.ParseAdd("application/json");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is >= 300 and < 400) throw new GitHubLoginException("unsafe_redirect", "GitHub 登录发生意外重定向，已停止；未发送到其他站点。");
            if (response.StatusCode == HttpStatusCode.TooManyRequests || (response.StatusCode == HttpStatusCode.Forbidden && (response.Headers.RetryAfter is not null || response.Headers.TryGetValues("X-RateLimit-Remaining", out var remaining) && remaining.Contains("0"))))
                throw new GitHubLoginException("rate_limited", "GitHub 请求受限，请稍后重试登录或检查。");
            if (response.StatusCode == HttpStatusCode.Unauthorized) throw new GitHubLoginException("bad_credentials", "GitHub 登录已失效，请重新登录。");
            if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound) throw new GitHubLoginException("access_required", "当前账号或 GitHub App 无法读取 Notesae/screenshot；请由发布者核对 App 安装及只读权限，不会自动扩权。");
            if (!response.IsSuccessStatusCode) throw new GitHubLoginException("login_failed", "GitHub 登录服务未能完成请求，请稍后重试。");
            await using var input = await response.Content.ReadAsStreamAsync(deadline.Token); using var output = new MemoryStream(); var buffer = new byte[16384];
            while (true) { var count = await input.ReadAsync(buffer, deadline.Token); if (count == 0) break; if (output.Length + count > maxBytes) throw InvalidResponse(); await output.WriteAsync(buffer.AsMemory(0, count), deadline.Token); }
            return JsonDocument.Parse(output.ToArray());
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new GitHubLoginException("timeout", "GitHub 登录请求超时，请取消或稍后重试。"); }
        catch (Exception e) when (e is HttpRequestException or IOException) { throw new GitHubLoginException("network_failed", "无法连接 GitHub 登录服务，请检查网络后重试。"); }
        catch (JsonException) { throw InvalidResponse(); }
    }
    private static string ReadString(JsonElement root, string name, int maximum)
    { if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || value.GetString() is not { } text || text.Length == 0 || text.Length > maximum) throw InvalidResponse(); return text; }
    private static int ReadSeconds(JsonElement root, string name, int maximum)
    { if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var seconds) || seconds <= 0 || seconds > maximum) throw InvalidResponse(); return seconds; }
    private static GitHubLoginException InvalidResponse() => new("invalid_response", "GitHub 登录响应格式或有效期无效，未保留登录信息。");
    // 空/非字符串 error 也拒绝，分别报告固定形态；不把不标准的成功/错误混合响应当作已授权。
    private static string? ReadOAuthError(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) throw InvalidResponse();
        if (!root.TryGetProperty("error", out var value)) return null;
        if (value.ValueKind == JsonValueKind.Null) throw new GitHubLoginException("oauth_null_error", "GitHub 授权响应的 error 字段为空值；已停止，未保留正文或登录信息。");
        if (value.ValueKind != JsonValueKind.String) throw new GitHubLoginException("oauth_invalid_error", "GitHub 授权响应的 error 字段类型无效；已停止，未保留正文或登录信息。");
        var code = value.GetString()!;
        if (string.IsNullOrWhiteSpace(code)) throw new GitHubLoginException("oauth_empty_error", "GitHub 授权响应的 error 字段为空字符串；已停止，未保留正文或登录信息。");
        return code;
    }
    // 只保留 GitHub 已知/标准 OAuth 错误枚举，绝不输出 error_description 或未知服务器字符串。
    private static GitHubLoginException OAuthError(string? code) => code switch
    {
        "device_flow_disabled" => new("device_flow_disabled", "此 App 未启用 Device flow。请发布者在官方 App 设置勾选设备码登录后，由用户另行确认重试。"),
        "incorrect_client_credentials" => new("client_id_mismatch", "GitHub 未接受公开 Client ID。请核对 App 的 Client ID（不是 App ID、secret 或私钥）。"),
        "bad_verification_code" or "incorrect_device_code" => new("device_code_rejected", "GitHub 拒绝了本次设备凭证；旧会话不能继续，需要用户另行确认后重新申请一次。"),
        "unsupported_grant_type" => new("grant_type_rejected", "GitHub 未接受设备授权协议参数，已结束本次请求；请先由发布者核对实现，不要扩大权限。"),
        "unverified_user_email" => new("email_unverified", "GitHub 要求用户先在官方账号设置确认主邮箱，应用不会代为操作。"),
        "application_suspended" => new("application_suspended", "GitHub App 当前被暂停，请发布者在官方页面核对；不会绕过限制。"),
        "invalid_request" => new("oauth_invalid_request", "GitHub 拒绝了授权请求格式；请发布者核对协议实现后，由用户另行确认重试。"),
        "invalid_grant" => new("oauth_invalid_grant", "GitHub 拒绝了本次授权凭证；旧会话已结束，不会自动重新申请。"),
        "invalid_scope" => new("oauth_invalid_scope", "GitHub 未接受请求的授权范围；不会改用更宽权限，请发布者核对 App 与协议。"),
        "unauthorized_client" => new("oauth_unauthorized_client", "GitHub 未允许此 App 使用当前授权流程，请发布者核对官方 App 设置。"),
        "server_error" or "temporarily_unavailable" => new("oauth_service_unavailable", "GitHub 授权服务暂不可用；本次流程已结束，再试需要用户另行确认。"),
        "expired_token" or "token_expired" => new("expired", "本次设备凭证已过期，需要用户另行确认后重新申请。"),
        "access_denied" => new("denied", "用户已拒绝本次授权，没有保留登录信息。"),
        _ => new("oauth_unrecognized_error", "GitHub 返回未识别的授权错误；已结束并清除会话。未保留服务器正文，请先核对实现后由用户另行确认重试。")
    };
    public void Dispose() { lock (_sync) { if (_disposed) return; _disposed = true; Reset(); _session.Dispose(); _status = new("signed-out", "应用会话已结束，登录信息已清除。"); } _http.Dispose(); }
}
