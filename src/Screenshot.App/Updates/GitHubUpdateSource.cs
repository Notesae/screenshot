using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App.Updates;

internal sealed record UpdateRelease(ReleaseVersion Version, bool Preview, string Notes, Uri PackageUrl, long Size, string Sha256, long AssetId = 0, Uri? AssetApiUrl = null);
internal sealed record UpdateProgress(long Received, long Total, string Phase = "downloading");

// 固定官方仓库，不读取浏览器、Git、环境或开发机凭据，也不接受用户输入的任意更新 URL。
internal sealed class GitHubUpdateSource : IDisposable
{
    internal const string Repository = GitHubUpdateIdentity.Repository;
    internal const long MaxPackageBytes = 1_000_000_000;
    private readonly HttpClient _http;
    private readonly Func<DateTimeOffset> _now;
    private DateTimeOffset _notBefore;
    private int _active;
    internal bool HasPreviewReleases { get; private set; }
    internal bool HasStableReleases { get; private set; }
    internal GitHubUpdateSource() : this(new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, Credentials = null, UseDefaultCredentials = false })) { }
    internal GitHubUpdateSource(HttpClient http, Func<DateTimeOffset>? now = null)
    {
        if (http.DefaultRequestHeaders.Authorization is not null || http.DefaultRequestHeaders.Contains("Cookie")) throw new ArgumentException("公开更新客户端不能预设认证或 Cookie。");
        _http = http; _now = now ?? (() => DateTimeOffset.UtcNow); _http.Timeout = TimeSpan.FromMinutes(30);
    }
    // 读取与下载共用门控；重复操作在创建文件或发送请求前拒绝。限流期间也不重复请求。
    private void BeginOperation()
    {
        if (Interlocked.CompareExchange(ref _active, 1, 0) != 0) throw new UpdateSourceException("update_busy", "已有更新请求，请等待完成或取消后重试。");
    }
    private void CheckRateLimit()
    { if (_notBefore > _now()) throw new UpdateSourceException("rate_limited", $"GitHub 匿名请求受限，请在 {_notBefore.ToLocalTime():g} 后重试。当前安装仍可使用。"); }
    private async Task VerifyRepositoryAsync(CancellationToken token)
    {
        using var response = await GetAsync(new($"https://api.github.com/repos/{Repository}"), false, token);
        RequireSuccess(response);
        using var identity = JsonDocument.Parse(await ReadLimitedAsync(response, 65536, token));
        GitHubUpdateIdentity.VerifyRepository(identity.RootElement);
    }

    // 分页读取发布列表后按版本排序；草稿、错误资产和缺失摘要一律不能安装。
    internal async Task<UpdateRelease?> CheckAsync(ReleaseVersion current, bool preview, CancellationToken token)
    {
        BeginOperation();
        try { CheckRateLimit(); return await CheckCoreAsync(current, preview, token); }
        catch (Exception e) when (e is JsonException or System.Collections.Generic.KeyNotFoundException or InvalidOperationException or FormatException or OverflowException)
        { throw new InvalidDataException("官方更新元数据格式无效，已拒绝使用；请联系发布者。"); }
        catch (Exception e) when (e is HttpRequestException || e is IOException && e is not InvalidDataException)
        { throw new UpdateSourceException("network_failed", "读取 GitHub 更新元数据失败，请检查网络后重试。"); }
        finally { Interlocked.Exchange(ref _active, 0); }
    }
    private async Task<UpdateRelease?> CheckCoreAsync(ReleaseVersion current, bool preview, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromMinutes(2)); token = deadline.Token;
        await VerifyRepositoryAsync(token);
        HasPreviewReleases = HasStableReleases = false;
        UpdateRelease? best = null;
        for (var page = 1; page <= 10; page++)
        {
            using var response = await GetAsync(new($"https://api.github.com/repos/{Repository}/releases?per_page=100&page={page}"), false, token);
            RequireSuccess(response);
            using var data = JsonDocument.Parse(await ReadLimitedAsync(response, 4 * 1024 * 1024, token));
            if (data.RootElement.ValueKind != JsonValueKind.Array) throw new InvalidDataException("官方版本列表格式无效。");
            foreach (var item in data.RootElement.EnumerateArray())
            {
                if (item.GetProperty("draft").GetBoolean()) continue;
                ReleaseVersion version;
                try { version = ReleaseVersion.Parse(item.GetProperty("tag_name").GetString()!); }
                catch (Exception e) when (e is FormatException or OverflowException) { continue; }
                var isPreview = item.GetProperty("prerelease").GetBoolean() || version.Pre != "";
                if (isPreview) HasPreviewReleases = true; else HasStableReleases = true;
                if ((!preview && isPreview) || version.CompareTo(current) <= 0 || (best is not null && version.CompareTo(best.Version) <= 0)) continue;
                var name = $"Screenshot-{version}-win-x64.zip";
                var assets = item.GetProperty("assets").EnumerateArray().Where(a => a.GetProperty("name").GetString() == name).ToArray();
                if (assets.Length > 1) throw new InvalidDataException("同一版本出现重复更新包，已拒绝选择。");
                if (assets.Length == 0) continue;
                var asset = assets[0];
                var digest = asset.TryGetProperty("digest", out var d) ? d.GetString() ?? "" : "";
                if (!Regex.IsMatch(digest, "^sha256:[0-9a-fA-F]{64}$")) throw new InvalidDataException("新版本缺少官方 API 提供的 SHA-256，已拒绝下载；请联系发布者补充校验信息。");
                var url = new Uri(asset.GetProperty("browser_download_url").GetString()!);
                if (!IsPackageUrl(url) || url.AbsolutePath != $"/{Repository}/releases/download/" + item.GetProperty("tag_name").GetString() + "/" + name)
                    throw new InvalidDataException("发布包地址不属于预期的官方版本。");
                var size = asset.GetProperty("size").GetInt64();
                if (size <= 0 || size > MaxPackageBytes) throw new InvalidDataException("发布包大小超出允许范围。");
                var notes = item.TryGetProperty("body", out var body) ? body.GetString() ?? "暂无版本说明。" : "暂无版本说明。";
                var assetId = asset.TryGetProperty("id", out var id) && id.TryGetInt64(out var parsedId) ? parsedId : 0;
                var apiUrl = asset.TryGetProperty("url", out var apiValue) && Uri.TryCreate(apiValue.GetString(), UriKind.Absolute, out var parsedUrl) ? parsedUrl : null;
                if (!IsAssetApiUrl(apiUrl, assetId)) throw new InvalidDataException("公开更新包的官方资产标识无效，已拒绝下载。");
                best = new(version, isPreview, notes.Length > 32000 ? notes[..32000] : notes, url, size, digest[7..].ToLowerInvariant(), assetId, apiUrl);
            }
            if (data.RootElement.GetArrayLength() < 100) return best;
        }
        throw new InvalidDataException("官方版本列表过长，未完成检查；请联系发布者。");
    }

    internal async Task DownloadAsync(UpdateRelease release, string destination, IProgress<UpdateProgress>? progress, CancellationToken token)
    {
        if (!IsPackageUrl(release.PackageUrl) || release.Size <= 0 || release.Size > MaxPackageBytes || !Regex.IsMatch(release.Sha256, "^[0-9a-f]{64}$"))
            throw new InvalidDataException("更新包来源或摘要无效。");
        var created = false;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromMinutes(30)); token = deadline.Token;
        BeginOperation();
        try
        {
            CheckRateLimit();
            await VerifyRepositoryAsync(token);
            if (!IsAssetApiUrl(release.AssetApiUrl, release.AssetId)) throw new InvalidDataException("更新包资产标识无效，请重新检查。");
            var file = $"Screenshot-{release.Version}-win-x64.zip";
            if (release.PackageUrl.AbsolutePath != $"/{Repository}/releases/download/v{release.Version}/{file}" && release.PackageUrl.AbsolutePath != $"/{Repository}/releases/download/{release.Version}/{file}")
                throw new InvalidDataException("更新包版本与官方地址不匹配。");
            using var response = await GetAsync(release.PackageUrl, true, token);
            RequireSuccess(response);
            if (response.Content.Headers.ContentLength is long declared && declared != release.Size) throw new InvalidDataException("下载大小与发布元数据不一致。");
            await using var input = await OpenDownloadStreamAsync(response, token);
            await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 131072, true);
            created = true;
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[131072]; long received = 0;
            while (true)
            {
                using var idle = CancellationTokenSource.CreateLinkedTokenSource(token); idle.CancelAfter(TimeSpan.FromSeconds(60));
                int count;
                try { count = await input.ReadAsync(buffer, idle.Token); }
                catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new UpdateSourceException("download_timeout", "更新下载超过一分钟没有响应，请重新下载。"); }
                catch (IOException) { throw new UpdateSourceException("download_interrupted", "更新下载连接中断，请重新下载；未保留可安装的部分包。"); }
                if (count == 0) break;
                received += count; if (received > release.Size) throw new InvalidDataException("下载超出声明大小。");
                hash.AppendData(buffer, 0, count); await output.WriteAsync(buffer.AsMemory(0, count), token);
                progress?.Report(new(received, release.Size));
            }
            if (received != release.Size || Convert.ToHexStringLower(hash.GetHashAndReset()) != release.Sha256) throw new InvalidDataException("更新包 SHA-256 或长度不匹配，已拒绝安装。");
            await output.FlushAsync(token); output.Flush(true);
        }
        catch { if (created && File.Exists(destination)) File.Delete(destination); throw; }
        finally { Interlocked.Exchange(ref _active, 0); }
    }

    private static async Task<Stream> OpenDownloadStreamAsync(HttpResponseMessage response, CancellationToken token)
    {
        try { return await response.Content.ReadAsStreamAsync(token); }
        catch (Exception e) when (e is IOException or HttpRequestException)
        { throw new UpdateSourceException("download_interrupted", "更新连接中断，请重新下载。"); }
    }

    internal static bool IsPackageUrl(Uri u) => u.Scheme == "https" && u.IsDefaultPort && u.UserInfo == "" && u.Host == "github.com" && u.Query == "" && u.Fragment == "" && u.AbsolutePath.StartsWith($"/{Repository}/releases/download/", StringComparison.Ordinal);
    internal static bool IsAssetApiUrl(Uri? u, long id) => id > 0 && u is not null && u.Scheme == "https" && u.Host == "api.github.com" && u.IsDefaultPort && u.UserInfo == "" && u.Fragment == "" && u.Query == "" && u.AbsolutePath == $"/repos/{Repository}/releases/assets/{id}";
    // 只允许 GitHub 已知资产 CDN；每一跳重新校验，不附带 Authorization 或 Cookie。
    private async Task<HttpResponseMessage> GetAsync(Uri uri, bool asset, CancellationToken token)
    {
        for (var redirects = 0; redirects <= 4; redirects++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd("Screenshot-Updater/0.4.8");
            request.Headers.Accept.ParseAdd(asset ? "application/octet-stream" : "application/vnd.github+json");
            // 公开源每跳创建匿名请求；不向 API 或 CDN 发送认证与 Cookie。
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(TimeSpan.FromSeconds(60));
            HttpResponseMessage response;
            try { response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token); }
            catch (OperationCanceledException) when (!token.IsCancellationRequested) { throw new UpdateSourceException("timeout", "GitHub 更新请求超时，请稍后重试。"); }
            catch (Exception e) when (e is HttpRequestException or IOException) { throw new UpdateSourceException("network_failed", "无法连接 GitHub 官方更新服务，请检查网络后重试。"); }
            if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308)) return response;
            var next = response.Headers.Location; response.Dispose();
            if (next is null) throw new InvalidDataException("更新重定向缺少地址。");
            next = next.IsAbsoluteUri ? next : new Uri(uri, next);
            if (!asset || next.Scheme != "https" || !next.IsDefaultPort || next.UserInfo != "" || next.Fragment != "" || next.Host is not ("release-assets.githubusercontent.com" or "objects.githubusercontent.com"))
                throw new InvalidDataException("更新重定向至未经验证的来源，已拒绝。");
            uri = next;
        }
        throw new InvalidDataException("更新下载重定向次数过多。");
    }
    private void RequireSuccess(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.TooManyRequests || (response.StatusCode == HttpStatusCode.Forbidden && (response.Headers.RetryAfter is not null || response.Headers.TryGetValues("X-RateLimit-Remaining", out var left) && left.Contains("0"))))
        {
            var now = _now(); var retry = response.Headers.RetryAfter;
            _notBefore = retry?.Date ?? now.Add(retry?.Delta ?? TimeSpan.FromMinutes(1));
            if (response.Headers.TryGetValues("X-RateLimit-Reset", out var reset) && long.TryParse(reset.FirstOrDefault(), out var seconds) && seconds > now.ToUnixTimeSeconds() && seconds <= now.AddHours(1).ToUnixTimeSeconds()) _notBefore = DateTimeOffset.FromUnixTimeSeconds(seconds);
            if (_notBefore <= now || _notBefore > now.AddHours(1)) _notBefore = now.AddMinutes(1);
            CheckRateLimit();
        }
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new UpdateSourceException("source_unavailable", "官方公开更新源暂不可访问。请稍后重试或联系发布者；不会请求登录、读取凭据或切换来源。");
        if (!response.IsSuccessStatusCode) throw new UpdateSourceException("source_failed", "GitHub 官方更新服务暂不可用，请稍后重试。");
    }
    private static async Task<byte[]> ReadLimitedAsync(HttpResponseMessage response, int max, CancellationToken token)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(token); using var output = new MemoryStream();
        var buffer = new byte[16384];
        while (true) { var n = await stream.ReadAsync(buffer, token); if (n == 0) return output.ToArray(); if (output.Length + n > max) throw new InvalidDataException("更新元数据过大。"); await output.WriteAsync(buffer.AsMemory(0, n), token); }
    }
    public void Dispose() => _http.Dispose();
}
