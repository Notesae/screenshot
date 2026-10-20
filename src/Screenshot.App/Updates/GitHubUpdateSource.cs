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

internal sealed record UpdateRelease(ReleaseVersion Version, bool Preview, string Notes, Uri PackageUrl, long Size, string Sha256);
internal sealed record UpdateProgress(long Received, long Total, string Phase = "downloading");

// 固定官方仓库，不读取浏览器、Git、环境或开发机凭据，也不接受用户输入的任意更新 URL。
internal sealed class GitHubUpdateSource : IDisposable
{
    internal const string Repository = "Notesae/screenshot";
    internal const long MaxPackageBytes = 1_000_000_000;
    private readonly HttpClient _http;
    internal GitHubUpdateSource() : this(new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, Credentials = null })) { }
    internal GitHubUpdateSource(HttpClient http) { _http = http; _http.Timeout = TimeSpan.FromMinutes(30); }

    // 分页读取发布列表后按版本排序；草稿、错误资产和缺失摘要一律不能安装。
    internal async Task<UpdateRelease?> CheckAsync(ReleaseVersion current, bool preview, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromMinutes(2)); token = deadline.Token;
        UpdateRelease? best = null;
        for (var page = 1; page <= 10; page++)
        {
            using var response = await GetAsync(new($"https://api.github.com/repos/{Repository}/releases?per_page=100&page={page}"), false, token);
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new InvalidOperationException("官方更新源不可访问：仓库可能为私有或请求受限。当前版本仍可使用；需发布者提供可访问的官方渠道，本应用不会读取 GitHub 凭据。可稍后重试检查。");
            response.EnsureSuccessStatusCode();
            using var data = JsonDocument.Parse(await ReadLimitedAsync(response, 4 * 1024 * 1024, token));
            if (data.RootElement.ValueKind != JsonValueKind.Array) throw new InvalidDataException("官方版本列表格式无效。");
            foreach (var item in data.RootElement.EnumerateArray())
            {
                if (item.GetProperty("draft").GetBoolean()) continue;
                ReleaseVersion version;
                try { version = ReleaseVersion.Parse(item.GetProperty("tag_name").GetString()!); }
                catch (Exception e) when (e is FormatException or OverflowException) { continue; }
                var isPreview = item.GetProperty("prerelease").GetBoolean() || version.Pre != "";
                if ((!preview && isPreview) || version.CompareTo(current) <= 0 || (best is not null && version.CompareTo(best.Version) <= 0)) continue;
                var name = $"Screenshot-{version}-win-x64.zip";
                var assets = item.GetProperty("assets").EnumerateArray().Where(a => a.GetProperty("name").GetString() == name).ToArray();
                if (assets.Length != 1) continue;
                var asset = assets[0];
                var digest = asset.TryGetProperty("digest", out var d) ? d.GetString() ?? "" : "";
                if (!Regex.IsMatch(digest, "^sha256:[0-9a-fA-F]{64}$")) throw new InvalidDataException("新版本缺少官方 API 提供的 SHA-256，已拒绝下载；请联系发布者补充校验信息。");
                var url = new Uri(asset.GetProperty("browser_download_url").GetString()!);
                if (!IsPackageUrl(url) || url.AbsolutePath != $"/{Repository}/releases/download/" + item.GetProperty("tag_name").GetString() + "/" + name)
                    throw new InvalidDataException("发布包地址不属于预期的官方版本。");
                var size = asset.GetProperty("size").GetInt64();
                if (size <= 0 || size > MaxPackageBytes) throw new InvalidDataException("发布包大小超出允许范围。");
                var notes = item.TryGetProperty("body", out var body) ? body.GetString() ?? "暂无版本说明。" : "暂无版本说明。";
                best = new(version, isPreview, notes.Length > 32000 ? notes[..32000] : notes, url, size, digest[7..].ToLowerInvariant());
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
        try
        {
            using var response = await GetAsync(release.PackageUrl, true, token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is long declared && declared != release.Size) throw new InvalidDataException("下载大小与发布元数据不一致。");
            await using var input = await response.Content.ReadAsStreamAsync(token);
            await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 131072, true);
            created = true;
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[131072]; long received = 0;
            while (true)
            {
                using var idle = CancellationTokenSource.CreateLinkedTokenSource(token); idle.CancelAfter(TimeSpan.FromSeconds(60));
                var count = await input.ReadAsync(buffer, idle.Token); if (count == 0) break;
                received += count; if (received > release.Size) throw new InvalidDataException("下载超出声明大小。");
                hash.AppendData(buffer, 0, count); await output.WriteAsync(buffer.AsMemory(0, count), token);
                progress?.Report(new(received, release.Size));
            }
            if (received != release.Size || Convert.ToHexStringLower(hash.GetHashAndReset()) != release.Sha256) throw new InvalidDataException("更新包 SHA-256 或长度不匹配，已拒绝安装。");
            await output.FlushAsync(token); output.Flush(true);
        }
        catch { if (created && File.Exists(destination)) File.Delete(destination); throw; }
    }

    internal static bool IsPackageUrl(Uri u) => u.Scheme == "https" && u.IsDefaultPort && u.UserInfo == "" && u.Host == "github.com" && u.Query == "" && u.Fragment == "" && u.AbsolutePath.StartsWith($"/{Repository}/releases/download/", StringComparison.Ordinal);
    // 只允许 GitHub 已知资产 CDN；每一跳重新校验，不附带 Authorization 或 Cookie。
    private async Task<HttpResponseMessage> GetAsync(Uri uri, bool asset, CancellationToken token)
    {
        for (var redirects = 0; redirects <= 4; redirects++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd("Screenshot-Updater/0.4.7");
            request.Headers.Accept.ParseAdd(asset ? "application/octet-stream" : "application/vnd.github+json");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(TimeSpan.FromSeconds(60));
            var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
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
    private static async Task<byte[]> ReadLimitedAsync(HttpResponseMessage response, int max, CancellationToken token)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(token); using var output = new MemoryStream();
        var buffer = new byte[16384];
        while (true) { var n = await stream.ReadAsync(buffer, token); if (n == 0) return output.ToArray(); if (output.Length + n > max) throw new InvalidDataException("更新元数据过大。"); await output.WriteAsync(buffer.AsMemory(0, n), token); }
    }
    public void Dispose() => _http.Dispose();
}
