using Screenshot.App.Updates;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// 全部文件位于专属 GUID 临时目录；不启动 Screenshot、不使用原生对话框或真实安装。
internal static class UpdateTests
{
    internal static async Task<int> RunAsync()
    {
        var checks = 0;
        void Check(bool value, string message) { if (!value) throw new Exception("更新测试：" + message); checks++; }
        void Reject(Action action, string message)
        {
            try { action(); } catch (Exception e) when (e is IOException or InvalidDataException or FormatException or OverflowException or InvalidOperationException) { checks++; return; }
            throw new Exception("更新测试未拒绝：" + message);
        }
        async Task RejectAsync(Func<Task> action, string message)
        {
            try { await action(); } catch (Exception e) when (e is IOException or InvalidDataException or InvalidOperationException or OperationCanceledException or HttpRequestException or UpdateSourceException) { checks++; return; }
            throw new Exception("更新测试未拒绝：" + message);
        }
        var root = Path.Combine(Path.GetTempPath(), "Screenshot-update-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            var ordered = new[] { "0.4.7-alpha", "0.4.7-alpha.2", "0.4.7-alpha.10", "0.4.7-beta", "0.4.7-rc.1", "0.4.7", "0.4.8", "1.0.0" };
            for (var i = 1; i < ordered.Length; i++) Check(ReleaseVersion.Parse(ordered[i]).CompareTo(ReleaseVersion.Parse(ordered[i - 1])) > 0, "SemVer 顺序");
            Check(ReleaseVersion.Parse("v0.4.7+build.1").CompareTo(ReleaseVersion.Parse("0.4.7+build.2")) == 0, "构建元数据不升级");
            foreach (var invalid in new[] { "0.4", "01.4.7", "0.4.7-01", "../0.4.7", "0.4.7.1", "9999999999999999.0.0" }) Reject(() => ReleaseVersion.Parse(invalid), "无效版本");
            foreach (var invalid in new[] { "../escape", "/absolute", "C:/absolute", "file:stream", "a/../../escape", "a\\escape", "CON", "com1.txt", "file.", "file ", "a//b" }) Reject(() => PortablePackage.Child(root, invalid), "Windows 路径");
            Check(!GitHubUpdateSource.IsPackageUrl(new("http://github.com/Notesae/screenshot/releases/download/v1/a.zip")), "拒绝 HTTP");
            Check(!GitHubUpdateSource.IsPackageUrl(new("https://github.com/evil/screenshot/releases/download/v1/a.zip")), "拒绝其他仓库");

            object Release(string version, bool preview, bool draft = false, string? digest = null, string? url = null) => new
            {
                tag_name = "v" + version, prerelease = preview, draft, body = "隔离模拟版本说明",
                assets = new[] { new { id = 42, url = "https://api.github.com/repos/Notesae/screenshot/releases/assets/42", name = $"Screenshot-{version}-win-x64.zip", size = 4, digest = digest ?? "sha256:" + new string('a', 64), browser_download_url = url ?? $"https://github.com/Notesae/screenshot/releases/download/v{version}/Screenshot-{version}-win-x64.zip" } }
            };
            var releases = JsonSerializer.Serialize(new[] { Release("0.4.9", true), Release("0.4.8", false), Release("9.0.0", false, true), Release("0.4.6", false) });
            using (var source = Source(_ => JsonResponse(releases)))
            {
                var stable = await source.CheckAsync(ReleaseVersion.Parse("0.4.7"), false, default);
                var preview = await source.CheckAsync(ReleaseVersion.Parse("0.4.7"), true, default);
                Check(stable?.Version.ToString() == "0.4.8" && stable.Notes == "隔离模拟版本说明", "稳定通道与说明");
                Check(preview?.Version.ToString() == "0.4.9" && preview.Preview, "预发布明确区分");
                Check(await source.CheckAsync(ReleaseVersion.Parse("10.0.0"), true, default) is null, "无降级候选");
            }
            using (var source = Source(_ => new(HttpStatusCode.NotFound))) await RejectAsync(() => source.CheckAsync(ReleaseVersion.Parse("0.4.7"), false, default), "私有源受限");
            using (var source = Source(_ => JsonResponse(JsonSerializer.Serialize(new[] { Release("0.4.8", false, digest: "") })))) await RejectAsync(() => source.CheckAsync(ReleaseVersion.Parse("0.4.7"), false, default), "缺失摘要");
            using (var source = Source(_ => JsonResponse(JsonSerializer.Serialize(new[] { Release("0.4.8", false, url: "https://evil.example/a.zip") })))) await RejectAsync(() => source.CheckAsync(ReleaseVersion.Parse("0.4.7"), false, default), "非官方资产");

            var bytes = Encoding.UTF8.GetBytes("test"); var digestValue = Convert.ToHexStringLower(SHA256.HashData(bytes));
            var candidate = new UpdateRelease(ReleaseVersion.Parse("0.4.8"), false, "", new("https://github.com/Notesae/screenshot/releases/download/v0.4.8/Screenshot-0.4.8-win-x64.zip"), bytes.Length, digestValue, 42, new("https://api.github.com/repos/Notesae/screenshot/releases/assets/42"));
            using (var source = Source(request => { Check(request.Headers.Authorization is null && !request.Headers.Contains("Cookie"), "请求无认证头"); return new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }; }))
            {
                var destination = Path.Combine(root, "download.zip");
                await source.DownloadAsync(candidate, destination, null, default);
                Check(File.ReadAllBytes(destination).SequenceEqual(bytes), "完整下载");
            }
            using (var source = Source(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }))
            {
                var destination = Path.Combine(root, "wrong.zip");
                await RejectAsync(() => source.DownloadAsync(candidate with { Sha256 = new string('b', 64) }, destination, null, default), "损坏摘要"); Check(!File.Exists(destination), "损坏包清理");
                await RejectAsync(() => source.DownloadAsync(candidate with { Size = 10 }, destination, null, default), "下载截断");
                using var cancel = new CancellationTokenSource(); cancel.Cancel();
                await RejectAsync(() => source.DownloadAsync(candidate, destination, null, cancel.Token), "下载取消");
                await source.DownloadAsync(candidate, destination, null, default); Check(File.Exists(destination), "取消后重试");
                await RejectAsync(() => source.DownloadAsync(candidate, destination, null, default), "目标已存在"); Check(File.ReadAllBytes(destination).SequenceEqual(bytes), "既有下载不被错误清理");
                using var midDownload = new CancellationTokenSource();
                var interrupted = Path.Combine(root, "interrupted.zip");
                await RejectAsync(() => source.DownloadAsync(candidate, interrupted, new InlineProgress(_ => midDownload.Cancel()), midDownload.Token), "传输中的主动取消");
                Check(!File.Exists(interrupted), "取消后不留可安装的部分包");
            }
            foreach (var redirect in new[] { "http://release-assets.githubusercontent.com/a", "https://evil.example/a", "https://github.com/evil/a", "https://user@release-assets.githubusercontent.com/a" })
            {
                var requests = 0;
                using var source = Source(_ => { requests++; var response = new HttpResponseMessage(HttpStatusCode.Redirect); response.Headers.Location = new(redirect); return response; });
                await RejectAsync(() => source.DownloadAsync(candidate, Path.Combine(root, "redirect.zip"), null, default), "恶意重定向"); Check(requests == 1, "恶意源未被请求");
            }
            using (var source = Source(request =>
            {
                if (request.RequestUri!.Host == "github.com") { var r = new HttpResponseMessage(HttpStatusCode.Redirect); r.Headers.Location = new("https://release-assets.githubusercontent.com/trusted?signature=temporary"); return r; }
                return new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
            })) { await source.DownloadAsync(candidate, Path.Combine(root, "cdn.zip"), null, default); Check(true, "官方 CDN 重定向"); }

            var package = Path.Combine(root, "fixture"); MakePackage(package, "0.4.8");
            var zip = Path.Combine(root, "valid.zip"); ZipFile.CreateFromDirectory(package, zip);
            var fixtureZip = File.ReadAllBytes(zip);
            var sessionTarget = Path.Combine(root, "session-current"); MakePackage(sessionTarget, "0.4.6");
            using (var session = new UpdateSession(sessionTarget, ReleaseVersion.Parse("0.4.6"), Source(_ => new(HttpStatusCode.OK) { Content = new ByteArrayContent(fixtureZip) })))
            {
                session.Release = candidate with { Size = fixtureZip.Length, Sha256 = Convert.ToHexStringLower(SHA256.HashData(fixtureZip)) };
                await session.DownloadAsync(new InlineProgress(), default);
                Check(session.Extracted is not null, "会话下载和隔离提取");
                var export = Path.Combine(root, "side-by-side"); session.ExportTo(export, default);
                Check(PortablePackage.ReadVersion(export).ToString() == "0.4.8", "并排导出完整新版本");
                Reject(() => session.ExportTo(export, default), "导出不得覆盖目录");
                var prepared = await session.PrepareAsync(default);
                Check(prepared.State == "prepared" && File.Exists(Path.Combine(prepared.Plan.Transaction, "worker", "Screenshot.exe")), "准备退出后工作目录");
                Check(File.ReadAllText(Path.Combine(sessionTarget, "Screenshot.exe")) == "fixture-0.4.6", "交接前原安装保持原样");
                prepared.Apply(); Check(PortablePackage.ReadVersion(sessionTarget).ToString() == "0.4.8", "下载到隔离目录事务闭环"); prepared.Recover();
                session.Invalidate(); Check(session.Extracted is null && session.Release is null, "切换通道作废候选并清理临时文件");
            }
            // 第二次下载/切通道必须在清理首笔暂存之前拒绝，首笔仍能完成校验。
            var concurrentTarget = Path.Combine(root, "session-concurrent"); MakePackage(concurrentTarget, "0.4.6");
            var downloadStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var finishDownload = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            using (var session = new UpdateSession(concurrentTarget, ReleaseVersion.Parse("0.4.6"), new GitHubUpdateSource(new HttpClient(new HeldHttp(async (request, token) =>
            {
                if (request.RequestUri!.Host == "api.github.com") return JsonResponse("{\"id\":1425162253,\"full_name\":\"Notesae/screenshot\",\"private\":false}");
                downloadStarted.TrySetResult(); await finishDownload.Task.WaitAsync(token);
                return new(HttpStatusCode.OK) { Content = new ByteArrayContent(fixtureZip) };
            })))))
            {
                session.Release = candidate with { Size = fixtureZip.Length, Sha256 = Convert.ToHexStringLower(SHA256.HashData(fixtureZip)) };
                var first = session.DownloadAsync(new InlineProgress(), default); await downloadStarted.Task;
                await RejectAsync(() => session.DownloadAsync(new InlineProgress(), default), "重复下载不清理首笔目录");
                Reject(() => session.Invalidate(), "下载中不能作废或删除暂存");
                finishDownload.TrySetResult(); await first;
                Check(session.Extracted is not null && Directory.Exists(session.Extracted), "重复操作后首笔完整校验成功");
            }
            var expanded = Path.Combine(root, "expanded"); PortablePackage.Extract(zip, expanded, ReleaseVersion.Parse("0.4.8"), default);
            Check(File.ReadAllText(Path.Combine(expanded, "Screenshot.exe")) == "fixture-0.4.8", "安全解压");
            Reject(() => PortablePackage.Verify(expanded, ReleaseVersion.Parse("0.4.9"), default), "包内版本不同");
            File.WriteAllText(Path.Combine(expanded, "user-project.txt"), "keep");
            Reject(() => PortablePackage.Verify(expanded, null, default), "用户文件不被替换");
            Check(File.ReadAllText(Path.Combine(expanded, "user-project.txt")) == "keep", "用户文件完整保留");
            foreach (var badPath in new[] { "../escaped", "CON.txt", "x:stream", "folder/../escaped", "a\\b" })
            {
                var badZip = Path.Combine(root, Guid.NewGuid() + ".zip");
                using (var archive = ZipFile.Open(badZip, ZipArchiveMode.Create)) { using var w = new StreamWriter(archive.CreateEntry(badPath).Open()); w.Write("bad"); }
                Reject(() => PortablePackage.Extract(badZip, Path.Combine(root, Guid.NewGuid().ToString()), ReleaseVersion.Parse("0.4.8"), default), "ZIP 越界/设备名");
            }
            var duplicateZip = Path.Combine(root, "duplicate.zip");
            using (var archive = ZipFile.Open(duplicateZip, ZipArchiveMode.Create)) { archive.CreateEntry("same.txt"); archive.CreateEntry("SAME.txt"); }
            Reject(() => PortablePackage.Extract(duplicateZip, Path.Combine(root, "duplicate"), ReleaseVersion.Parse("0.4.8"), default), "大小写重复");
            var linkZip = Path.Combine(root, "link.zip");
            using (var archive = ZipFile.Open(linkZip, ZipArchiveMode.Create)) { var entry = archive.CreateEntry("link"); entry.ExternalAttributes = unchecked((int)0xA1FF0000); }
            Reject(() => PortablePackage.Extract(linkZip, Path.Combine(root, "link"), ReleaseVersion.Parse("0.4.8"), default), "符号链接");

            foreach (var failure in new[] { "old-moved", "new-moved", "none" })
            {
                var tx = MakeTransaction(Path.Combine(root, failure));
                if (failure != "none") Reject(() => tx.Apply(stage => { if (stage == failure) throw new IOException("模拟磁盘故障"); }), "替换阶段故障");
                else { tx.Apply(); Check(tx.State == "awaiting-health" && Directory.Exists(tx.Previous), "整目录更新与旧版保留"); tx.Recover(); }
                Check(File.ReadAllText(Path.Combine(tx.Plan.Target, "Screenshot.exe")) == "fixture-0.4.6", "失败后回滚旧版");
                Check(tx.State == "rolled-back", "回滚日志");
            }
            var crash = MakeTransaction(Path.Combine(root, "crash"));
            crash.SetState("moving-old"); Directory.Move(crash.Plan.Target, crash.Previous);
            UpdateTransaction.Load(crash.Plan.Transaction).Recover(); Check(Directory.Exists(crash.Plan.Target), "旧目录移动后崩溃恢复");
            var journalFailure = MakeTransaction(Path.Combine(root, "journal-failure")); FileStream? journalLock = null;
            try
            {
                Reject(() => journalFailure.Apply(stage => { if (stage == "old-moved") journalLock = new FileStream(journalFailure.StatePath + ".tmp", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }), "日志写入失败");
                Check(File.ReadAllText(Path.Combine(journalFailure.Plan.Target, "Screenshot.exe")) == "fixture-0.4.6", "日志不可写仍恢复旧目录");
            }
            finally { journalLock?.Dispose(); }
            journalFailure.Recover(); Check(journalFailure.State == "rolled-back", "恢复日志可补写");
            var crashNew = MakeTransaction(Path.Combine(root, "crash-new"));
            crashNew.SetState("moving-new"); Directory.Move(crashNew.Plan.Target, crashNew.Previous); Directory.Move(crashNew.Incoming, crashNew.Plan.Target);
            crashNew.Recover(); Check(Directory.Exists(crashNew.Failed) && File.ReadAllText(Path.Combine(crashNew.Plan.Target, "Screenshot.exe")) == "fixture-0.4.6", "新目录移动后崩溃恢复");
            var altered = MakeTransaction(Path.Combine(root, "tamper")); File.AppendAllText(Path.Combine(altered.Incoming, "Screenshot.exe"), "corrupt");
            Reject(() => altered.Apply(), "暂存文件被修改"); Check(!Directory.Exists(altered.Previous), "损坏候选不触碰原安装");
            var downgrade = MakeTransaction(Path.Combine(root, "downgrade"), "0.4.5"); Reject(() => downgrade.Apply(), "执行阶段再拒绝降级");
            var concurrent = MakeTransaction(Path.Combine(root, "concurrent"));
            using (UpdateTransaction.Acquire(concurrent.Plan.Target)) Reject(() => UpdateTransaction.Acquire(concurrent.Plan.Target).Dispose(), "并发锁");
            using (UpdateTransaction.Acquire(concurrent.Plan.Target)) Check(true, "锁释放可重试");
            var locked = MakeTransaction(Path.Combine(root, "locked"));
            using (var file = new FileStream(Path.Combine(locked.Plan.Target, "Screenshot.exe"), FileMode.Open, FileAccess.Read, FileShare.None)) Reject(() => locked.Apply(), "文件被占用");
            Check(Directory.Exists(locked.Plan.Target) && !Directory.Exists(locked.Previous), "占用失败原安装保留");
            var externalData = Path.Combine(root, "user-data"); Directory.CreateDirectory(externalData); File.WriteAllText(Path.Combine(externalData, "settings.txt"), "private-fixture");
            var preserve = MakeTransaction(Path.Combine(root, "preserve")); preserve.Apply(); preserve.Recover();
            Check(File.ReadAllText(Path.Combine(externalData, "settings.txt")) == "private-fixture", "数据目录不随安装替换");
            Console.WriteLine($"PASS {checks} update source, SemVer, integrity, cancellation, Windows ZIP paths, isolated swap/crash/rollback checks"); return checks;
        }
        finally
        {
            var full = Path.GetFullPath(root);
            if (full.StartsWith(Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(full).StartsWith("Screenshot-update-tests-")) Directory.Delete(full, true);
        }
    }
    private static GitHubUpdateSource Source(Func<HttpRequestMessage, HttpResponseMessage> handle) => new(new HttpClient(new FakeHttp(request => request.RequestUri!.AbsolutePath == "/repos/Notesae/screenshot" ? JsonResponse("{\"id\":1425162253,\"full_name\":\"Notesae/screenshot\",\"private\":false}") : handle(request))));
    private sealed class InlineProgress(Action<UpdateProgress>? onProgress = null) : IProgress<UpdateProgress> { public void Report(UpdateProgress value) => onProgress?.Invoke(value); }
    private sealed class FakeHttp(Func<HttpRequestMessage, HttpResponseMessage> handle) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { token.ThrowIfCancellationRequested(); return Task.FromResult(handle(request)); }
    }
    private sealed class HeldHttp(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handle) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => handle(request, token); }
    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    private static void MakePackage(string directory, string version)
    {
        Directory.CreateDirectory(directory);
        foreach (var name in new[] { "Screenshot.exe", "Screenshot.dll", "Screenshot.runtimeconfig.json", "web/index.html", "legal/terms-manifest.json" })
        { var p = Path.Combine(directory, name); Directory.CreateDirectory(Path.GetDirectoryName(p)!); File.WriteAllText(p, "fixture-" + version); }
        File.WriteAllText(Path.Combine(directory, "sbom.cdx.json"), JsonSerializer.Serialize(new { metadata = new { component = new { version } } }));
        File.WriteAllText(Path.Combine(directory, "SHA256SUMS.txt"), string.Join('\n', Directory.GetFiles(directory, "*", SearchOption.AllDirectories).Order().Select(p => PortablePackage.Digest(p) + "  " + Path.GetRelativePath(directory, p).Replace('\\', '/'))) + "\n");
    }
    private static UpdateTransaction MakeTransaction(string directory, string version = "0.4.8")
    {
        Directory.CreateDirectory(directory); var target = Path.Combine(directory, "application"); MakePackage(target, "0.4.6");
        var tx = Path.Combine(directory, ".screenshot-update-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(tx); var package = Path.Combine(tx, "package"); MakePackage(package, version);
        var transaction = new UpdateTransaction(new(target, tx, version, PortablePackage.Digest(Path.Combine(package, "SHA256SUMS.txt")), PortablePackage.Digest(Path.Combine(target, "SHA256SUMS.txt")))); transaction.Save(); return transaction;
    }
}
