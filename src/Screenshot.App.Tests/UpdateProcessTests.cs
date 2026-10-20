using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Screenshot.App.Updates;

// 显式启用的无窗口进程夹具：仅链接生产更新逻辑，不启动 WPF、条款或真实应用。
internal static class UpdateProcessTests
{
    private const string RootVariable = "SCREENSHOT_UPDATE_PROCESS_TEST_ROOT";
    private const string CaseVariable = "SCREENSHOT_UPDATE_PROCESS_TEST_CASE";
    private const string RunVariable = "SCREENSHOT_UPDATE_PROCESS_TEST_RUN";
    private const string ModeVariable = "SCREENSHOT_UPDATE_PROCESS_TEST_MODE";
    private const string Marker = "headless-update-fixture-v1";
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(25);

    internal static async Task<int?> TryDispatchAsync(string[] args)
    {
        if (args is ["--update-process-suite"]) return await RunSuiteAsync();
        var root = Environment.GetEnvironmentVariable(RootVariable);
        if (string.IsNullOrEmpty(root)) return null;
        // 环境标记不足以启用子进程入口；可执行文件也必须来自专用 GUID 根目录。
        if (!System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(root), "^Screenshot-process-tests-[a-f0-9]{32}$")
            || !Inside(root, AppContext.BaseDirectory) || File.ReadAllText(Path.Combine(root, "fixture.txt")) != Marker)
            throw new InvalidDataException("进程夹具边界无效。");
        var caseRoot = Environment.GetEnvironmentVariable(CaseVariable) ?? throw new InvalidDataException("缺少夹具案例目录。");
        if (!Inside(root, caseRoot)) throw new InvalidDataException("夹具案例越界。");
        var run = Environment.GetEnvironmentVariable(RunVariable) ?? "";
        if (!Guid.TryParseExact(run, "N", out _)) throw new InvalidDataException("夹具运行标识无效。");
        var prefix = Path.Combine(caseRoot, run);
        if (args is ["--fixture-parent", var directory, var operation])
        {
            var tx = LoadFixtureTransaction(root, directory);
            try
            {
                using var instance = new FileStream(UpdateTransaction.InstancePath(tx.Plan.Target), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite);
                using var session = new UpdateSession(tx.Plan.Target, PortablePackage.ReadVersion(tx.Plan.Target));
                await session.HandOffAsync(tx, operation == "rollback");
                File.WriteAllText(prefix + ".parent-ready", "confirmed");
                // 测试控制器明确放行之前，父进程继续持有实例租约。
                await UntilAsync(() => File.Exists(prefix + ".release-parent"), "等待测试控制器放行父进程");
                return 0;
            }
            catch (Exception error)
            {
                File.WriteAllText(prefix + ".parent-error", error.GetType().Name + ": " + error.Message);
                return 2;
            }
        }
        if (args.Length == 4 && args[0] is "--apply-update" or "--rollback-update")
        {
            var tx = LoadFixtureTransaction(root, args[1]); var code = 1;
            try { code = await UpdateTransaction.RunWorkerAsync(args[1], int.Parse(args[2]), long.Parse(args[3]), args[0] == "--rollback-update"); }
            catch (Exception error)
            {
                // 与宿主的后台异常出口一致；异常记录只写本案例事务目录。
                File.WriteAllText(Path.Combine(tx.Plan.Transaction, "handoff-error.txt"), error.GetType().Name + ": " + error.Message);
                if (!Directory.Exists(tx.Previous) && Directory.Exists(tx.Plan.Target) && tx.State != "rolled-back") tx.SetState("aborted");
            }
            File.WriteAllText(prefix + ".worker.json", JsonSerializer.Serialize(new { pid = Environment.ProcessId, code, state = tx.State }));
            return code;
        }
        if (args is ["--updated", var updatedDirectory])
        {
            var tx = LoadFixtureTransaction(root, updatedDirectory);
            File.WriteAllText(prefix + ".new.json", JsonSerializer.Serialize(new { pid = Environment.ProcessId, version = PortablePackage.ReadVersion(AppContext.BaseDirectory).ToString() }));
            if (Environment.GetEnvironmentVariable(ModeVariable) == "early-exit") return 23;
            File.WriteAllText(Path.Combine(tx.Plan.Transaction, "healthy"), "fixture-ready");
            return 0;
        }
        if (args.Length == 0)
        {
            File.WriteAllText(prefix + ".old.json", JsonSerializer.Serialize(new { pid = Environment.ProcessId, version = PortablePackage.ReadVersion(AppContext.BaseDirectory).ToString() }));
            return 0;
        }
        throw new InvalidDataException("不支持的进程夹具入口。");
    }

    private static UpdateTransaction LoadFixtureTransaction(string root, string directory)
    {
        if (!Inside(root, directory)) throw new InvalidDataException("夹具事务越界。");
        var tx = UpdateTransaction.Load(directory);
        if (!Inside(root, tx.Plan.Target)) throw new InvalidDataException("夹具安装目录越界。");
        return tx;
    }

    private static async Task<int> RunSuiteAsync()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("进程夹具仅在 Windows 后台执行。");
        var parent = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "artifacts", "windows-process-tests"));
        PortablePackage.NoLinks(parent); Directory.CreateDirectory(parent);
        var root = Path.Combine(parent, "Screenshot-process-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root); File.WriteAllText(Path.Combine(root, "fixture.txt"), Marker);
        var checks = 0; var results = new List<object>();
        void Check(bool condition, string label) { if (!condition) throw new Exception(label); checks++; }
        try
        {
            // 使用真实 Windows PID/退出/文件锁，包内程序则是此测试宿主的副本。
            var success = CreateCase(root, "commit-and-explicit-rollback");
            using (var process = StartParent(root, success, "healthy", false, out var prefix))
            {
                await UntilAsync(() => File.Exists(prefix + ".parent-ready"), "更新辅助进程就绪", process);
                Check(!process.HasExited && success.State == "ready", "辅助进程必须等待仍运行的父进程");
                Check(PortablePackage.Verify(success.Plan.Target, null, default) == success.Plan.PreviousDigest && !Directory.Exists(success.Previous), "父进程退出前原目录不变");
                ReleaseParent(prefix); await WaitForExitAsync(process); Check(process.ExitCode == 0, "更新父进程正常退出");
                await UntilAsync(() => File.Exists(prefix + ".worker.json"), "更新工作进程完成");
                Check(success.State == "committed" && WorkerCode(prefix) == 0, "新进程健康后事务提交");
                Check(PortablePackage.Verify(success.Plan.Target, ReleaseVersion.Parse("0.4.9"), default) == success.Plan.PackageDigest, "新目录完整摘要及版本一致");
                Check(PortablePackage.Verify(success.Previous, ReleaseVersion.Parse("0.4.8"), default) == success.Plan.PreviousDigest, "旧版本备份完整保留");
                Check(ReadPid(prefix + ".new.json") != process.Id, "更新后以独立 Windows 进程启动");
            }
            using (var process = StartParent(root, success, "healthy", true, out var prefix))
            {
                await UntilAsync(() => File.Exists(prefix + ".parent-ready"), "回滚辅助进程就绪", process);
                Check(!process.HasExited && success.State == "rollback-ready", "回滚也等待父进程退出");
                ReleaseParent(prefix); await WaitForExitAsync(process);
                await UntilAsync(() => File.Exists(prefix + ".worker.json") && File.Exists(prefix + ".old.json"), "回滚及旧进程重启完成");
                Check(process.ExitCode == 0 && WorkerCode(prefix) == 0 && success.State == "rolled-back", "显式回滚完成");
                Check(PortablePackage.Verify(success.Plan.Target, ReleaseVersion.Parse("0.4.8"), default) == success.Plan.PreviousDigest, "显式回滚恢复完整原目录");
                Check(PortablePackage.Verify(success.Failed, ReleaseVersion.Parse("0.4.9"), default) == success.Plan.PackageDigest, "被回滚的新版本保留以供诊断");
                Check(ReadPid(prefix + ".old.json") != process.Id, "旧版本以独立进程重启");
            }
            Check(SentinelUnchanged(success), "成功及显式回滚均保留隔离数据哨兵");
            results.Add(Result(success, "commit-and-explicit-rollback"));

            var failed = CreateCase(root, "new-process-early-exit");
            using (var process = StartParent(root, failed, "early-exit", false, out var prefix))
            {
                await UntilAsync(() => File.Exists(prefix + ".parent-ready"), "故障案例辅助进程就绪", process);
                ReleaseParent(prefix); await WaitForExitAsync(process);
                await UntilAsync(() => File.Exists(prefix + ".worker.json") && File.Exists(prefix + ".old.json"), "启动失败自动回滚");
                Check(failed.State == "rolled-back" && WorkerCode(prefix) == 1, "新进程提前退出触发自动回滚");
                Check(File.Exists(prefix + ".new.json") && File.Exists(Path.Combine(failed.Plan.Transaction, "handoff-error.txt")), "启动失败留存受控错误和实际子进程证据");
                Check(PortablePackage.Verify(failed.Plan.Target, null, default) == failed.Plan.PreviousDigest, "自动回滚恢复完整旧目录");
                Check(PortablePackage.Verify(failed.Failed, null, default) == failed.Plan.PackageDigest && SentinelUnchanged(failed), "故障新目录和数据哨兵保留");
            }
            results.Add(Result(failed, "new-process-early-exit"));

            foreach (var scenario in new[] { "other-instance-lock", "late-cancellation", "corrupt-staged-package" })
            {
                var tx = CreateCase(root, scenario);
                if (scenario == "corrupt-staged-package") File.AppendAllText(Path.Combine(tx.Incoming, "Screenshot.dll"), "corrupt");
                using var other = scenario == "other-instance-lock" ? new FileStream(UpdateTransaction.InstancePath(tx.Plan.Target), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite) : null;
                using var process = StartParent(root, tx, "healthy", false, out var prefix);
                if (scenario == "corrupt-staged-package")
                {
                    await WaitForExitAsync(process);
                    Check(process.ExitCode == 2 && File.Exists(prefix + ".parent-error"), "暂存损坏时交接失败且父进程得到错误");
                }
                else
                {
                    await UntilAsync(() => File.Exists(prefix + ".parent-ready"), "拒绝案例辅助进程就绪", process);
                    if (scenario == "late-cancellation") File.WriteAllText(Path.Combine(tx.Plan.Transaction, "handoff-cancelled"), "fixture-cancelled");
                    ReleaseParent(prefix); await WaitForExitAsync(process);
                }
                await UntilAsync(() => File.Exists(prefix + ".worker.json"), "拒绝案例工作进程完成");
                Check(tx.State == "aborted" && WorkerCode(prefix) == 1, scenario + "安全终止");
                Check(PortablePackage.Verify(tx.Plan.Target, null, default) == tx.Plan.PreviousDigest && !Directory.Exists(tx.Previous), scenario + "原目录完全不变");
                Check(!File.Exists(prefix + ".new.json") && !File.Exists(prefix + ".old.json") && SentinelUnchanged(tx), scenario + "不启动包程序且数据哨兵不变");
                results.Add(Result(tx, scenario));
            }
            var evidence = new { passed = true, checks, scenarios = 6, root, productionApplicationLaunched = false, wpfWindowCreated = false, realUserDataAccessed = false, payload = "source-linked headless fixture; synthetic versions 0.4.8 -> 0.4.9", results };
            var json = JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(Path.Combine(root, "result.json"), json);
            Console.WriteLine($"PASS {checks} Windows process update checks across 6 scenarios; evidence={Path.Combine(root, "result.json")}");
            return 0;
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(root, "failure.txt"), error.ToString());
            throw new Exception("后台更新进程测试失败；隔离证据：" + root, error);
        }
    }

    private static UpdateTransaction CreateCase(string root, string name)
    {
        var caseRoot = Path.Combine(root, name); Directory.CreateDirectory(caseRoot);
        File.WriteAllText(Path.Combine(caseRoot, "user-data-sentinel.txt"), "isolated-user-data-unchanged");
        var target = Path.Combine(caseRoot, "installation"); MakeFixturePackage(target, "0.4.8");
        var directory = Path.Combine(caseRoot, ".screenshot-update-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var incoming = Path.Combine(directory, "package"); MakeFixturePackage(incoming, "0.4.9");
        var before = PortablePackage.Verify(target, null, default);
        var tx = new UpdateTransaction(new(target, directory, "0.4.9", PortablePackage.Verify(incoming, null, default), before));
        PortablePackage.CopyVerified(target, Path.Combine(directory, "worker"), default); tx.Save(); return tx;
    }

    // 重命名 apphost 仍加载内嵌的 Tests.dll；Screenshot.dll 等仅是包校验所需的文本夹具。
    private static void MakeFixturePackage(string destination, string version)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(AppContext.BaseDirectory, "*", SearchOption.AllDirectories))
        {
            var target = PortablePackage.Child(destination, Path.GetRelativePath(AppContext.BaseDirectory, file).Replace('\\', '/'));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(file, target);
        }
        File.Move(Path.Combine(destination, "Screenshot.App.Tests.exe"), Path.Combine(destination, "Screenshot.exe"));
        foreach (var name in new[] { "Screenshot.dll", "Screenshot.runtimeconfig.json", "web/index.html", "legal/terms-manifest.json" })
        {
            var file = PortablePackage.Child(destination, name); Directory.CreateDirectory(Path.GetDirectoryName(file)!); File.WriteAllText(file, "headless synthetic fixture only");
        }
        File.WriteAllText(Path.Combine(destination, "sbom.cdx.json"), JsonSerializer.Serialize(new { metadata = new { component = new { version } } }));
        var sums = Directory.EnumerateFiles(destination, "*", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.Ordinal)
            .Select(p => PortablePackage.Digest(p) + "  " + Path.GetRelativePath(destination, p).Replace('\\', '/'));
        File.WriteAllText(Path.Combine(destination, "SHA256SUMS.txt"), string.Join('\n', sums) + "\n");
        PortablePackage.Verify(destination, ReleaseVersion.Parse(version), default);
    }

    private static Process StartParent(string root, UpdateTransaction tx, string mode, bool rollback, out string prefix)
    {
        var run = Guid.NewGuid().ToString("N"); var caseRoot = Path.GetDirectoryName(tx.Plan.Target)!; prefix = Path.Combine(caseRoot, run);
        var info = new ProcessStartInfo(Path.Combine(tx.Plan.Target, "Screenshot.exe")) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = caseRoot };
        info.ArgumentList.Add("--fixture-parent"); info.ArgumentList.Add(tx.Plan.Transaction); info.ArgumentList.Add(rollback ? "rollback" : "apply");
        info.Environment[RootVariable] = root; info.Environment[CaseVariable] = caseRoot; info.Environment[RunVariable] = run; info.Environment[ModeVariable] = mode;
        // 仅子进程使用现有运行时及案例临时目录，不修改系统环境或用户资料目录。
        info.Environment["DOTNET_ROOT"] = Directory.GetParent(RuntimeEnvironment.GetRuntimeDirectory().TrimEnd(Path.DirectorySeparatorChar))!.Parent!.Parent!.FullName;
        var temporary = Path.Combine(caseRoot, "temp"); Directory.CreateDirectory(temporary); info.Environment["TEMP"] = temporary; info.Environment["TMP"] = temporary;
        return Process.Start(info) ?? throw new IOException("无法启动后台测试进程。");
    }

    private static void ReleaseParent(string prefix) => File.WriteAllText(prefix + ".release-parent", "exit");
    private static int WorkerCode(string prefix) { using var json = JsonDocument.Parse(File.ReadAllText(prefix + ".worker.json")); return json.RootElement.GetProperty("code").GetInt32(); }
    private static int ReadPid(string file) { using var json = JsonDocument.Parse(File.ReadAllText(file)); return json.RootElement.GetProperty("pid").GetInt32(); }
    private static bool SentinelUnchanged(UpdateTransaction tx) => File.ReadAllText(Path.Combine(Path.GetDirectoryName(tx.Plan.Target)!, "user-data-sentinel.txt")) == "isolated-user-data-unchanged";
    private static object Result(UpdateTransaction tx, string name) => new { name, state = tx.State, targetVersion = PortablePackage.ReadVersion(tx.Plan.Target).ToString(), targetManifest = PortablePackage.Digest(Path.Combine(tx.Plan.Target, "SHA256SUMS.txt")), sentinelUnchanged = SentinelUnchanged(tx) };
    private static bool Inside(string root, string path) => Path.GetFullPath(path).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    private static async Task UntilAsync(Func<bool> condition, string operation, Process? process = null)
    {
        var timer = Stopwatch.StartNew();
        while (!condition())
        {
            if (process?.HasExited == true) throw new IOException(operation + "：父进程提前退出。");
            if (timer.Elapsed > Timeout) throw new TimeoutException(operation);
            await Task.Delay(50);
        }
    }
    private static async Task WaitForExitAsync(Process process)
    {
        using var timeout = new CancellationTokenSource(Timeout); await process.WaitForExitAsync(timeout.Token);
    }
}
