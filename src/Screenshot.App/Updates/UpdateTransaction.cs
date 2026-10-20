using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App.Updates;

internal sealed record UpdatePlan(string Target, string Transaction, string Version, string PackageDigest, string PreviousDigest);

// 整目录重命名避免逐文件半更新；日志、旧目录和独立工作进程均放在安装目录之外。
internal sealed class UpdateTransaction
{
    internal UpdatePlan Plan { get; }
    internal string Incoming => Path.Combine(Plan.Transaction, "package");
    internal string Previous => Path.Combine(Plan.Transaction, "previous");
    internal string Failed => Path.Combine(Plan.Transaction, "failed");
    internal string StatePath => Path.Combine(Plan.Transaction, "state.txt");
    internal string State => File.Exists(StatePath) ? File.ReadAllText(StatePath) : "prepared";
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal UpdateTransaction(UpdatePlan plan)
    {
        Plan = plan;
        var parent = Path.GetDirectoryName(Path.GetFullPath(plan.Target).TrimEnd(Path.DirectorySeparatorChar));
        if (parent is null || !Path.IsPathFullyQualified(plan.Target) || !Path.IsPathFullyQualified(plan.Transaction)
            || !string.Equals(Path.GetDirectoryName(Path.GetFullPath(plan.Transaction)), parent, StringComparison.OrdinalIgnoreCase)
            || !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(plan.Transaction), "^\\.screenshot-update-[a-f0-9]{32}$")) throw new InvalidDataException("更新事务目录关系无效。");
        if (!System.Text.RegularExpressions.Regex.IsMatch(plan.PackageDigest, "^[a-f0-9]{64}$") || !System.Text.RegularExpressions.Regex.IsMatch(plan.PreviousDigest, "^[a-f0-9]{64}$")) throw new InvalidDataException("更新事务摘要无效。");
        ReleaseVersion.Parse(plan.Version); PortablePackage.NoLinks(plan.Target); PortablePackage.NoLinks(plan.Transaction);
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot");
        var target = Path.GetFullPath(plan.Target).TrimEnd(Path.DirectorySeparatorChar);
        if (target.Equals(parent, StringComparison.OrdinalIgnoreCase) || target.Equals(data, StringComparison.OrdinalIgnoreCase)
            || data.StartsWith(target + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || target.StartsWith(data + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new IOException("安装目录与用户数据目录重叠，请将便携包解压到独立目录。");
    }
    internal static FileStream Acquire(string target)
    {
        var locks = Path.Combine(Path.GetTempPath(), "Screenshot-update-locks"); PortablePackage.NoLinks(locks); Directory.CreateDirectory(locks);
        var key = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar).ToUpperInvariant())));
        var path = Path.Combine(locks, key + ".lock"); PortablePackage.NoLinks(path);
        return new(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }
    internal static string InstancePath(string target) => Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar) + ".instance.lock";
    internal void Save()
    {
        AtomicText(Path.Combine(Plan.Transaction, "plan.json"), JsonSerializer.Serialize(Plan, Json));
        AtomicText(Plan.Target.TrimEnd(Path.DirectorySeparatorChar) + ".update.json", JsonSerializer.Serialize(Plan, Json));
        SetState("prepared");
        AtomicText(Path.Combine(Plan.Transaction, "恢复说明.txt"), "此目录保留旧版本与恢复工具，不含用户配置备份。若更新中断或主程序无法启动，先关闭 Screenshot，再运行：\r\n\"" + PortablePackage.Executable(Path.Combine(Plan.Transaction, "worker")) + "\" --recover-update \"" + Plan.Transaction + "\"\r\n用户设置和恢复项目始终位于 %LOCALAPPDATA%\\Screenshot；请勿删除。\r\n");
    }
    internal static UpdateTransaction Load(string directory)
    {
        PortablePackage.NoLinks(directory); var path = Path.Combine(directory, "plan.json");
        if (new FileInfo(path).Length > 8192) throw new InvalidDataException("更新事务过大。");
        var plan = JsonSerializer.Deserialize<UpdatePlan>(File.ReadAllText(path), Json) ?? throw new InvalidDataException("更新事务无效。");
        if (!string.Equals(Path.GetFullPath(plan.Transaction), Path.GetFullPath(directory), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("更新事务身份无效。");
        return new(plan);
    }
    internal static UpdateTransaction? Find(string target)
    {
        var path = target.TrimEnd(Path.DirectorySeparatorChar) + ".update.json";
        if (!File.Exists(path)) return null; PortablePackage.NoLinks(path);
        if (new FileInfo(path).Length > 8192) throw new InvalidDataException("更新记录无效。");
        var plan = JsonSerializer.Deserialize<UpdatePlan>(File.ReadAllText(path), Json) ?? throw new InvalidDataException("更新记录无效。");
        if (!string.Equals(Path.GetFullPath(plan.Target).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("更新目标不匹配。");
        return Load(plan.Transaction);
    }
    internal void SetState(string state) => AtomicText(StatePath, state);
    private static void AtomicText(string path, string text)
    {
        PortablePackage.NoLinks(path); var temporary = path + ".tmp";
        PortablePackage.NoLinks(temporary);
        using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        { var bytes = System.Text.Encoding.UTF8.GetBytes(text); stream.Write(bytes); stream.Flush(true); }
        File.Move(temporary, path, true);
    }
    internal void ValidateIncoming()
    {
        if (PortablePackage.Verify(Incoming, ReleaseVersion.Parse(Plan.Version), CancellationToken.None) != Plan.PackageDigest) throw new InvalidDataException("暂存包在校验后发生变化。");
    }
    // 可注入的阶段钩子只供隔离故障测试；生产不传钩子。
    internal void Apply(Action<string>? checkpoint = null)
    {
        if (State is not ("prepared" or "ready")) throw new IOException("更新事务已执行，不能重复安装。");
        ValidateIncoming();
        if (PortablePackage.Verify(Plan.Target, null, CancellationToken.None) != Plan.PreviousDigest) throw new IOException("当前安装已改变，请重新检查更新。");
        if (ReleaseVersion.Parse(Plan.Version).CompareTo(PortablePackage.ReadVersion(Plan.Target)) <= 0) throw new IOException("更新目标不是更高版本，拒绝降级或重复安装。");
        try
        {
            SetState("moving-old"); Directory.Move(Plan.Target, Previous); checkpoint?.Invoke("old-moved");
            SetState("moving-new"); Directory.Move(Incoming, Plan.Target); checkpoint?.Invoke("new-moved"); SetState("awaiting-health");
        }
        catch { Recover(); throw; }
    }
    internal void Recover()
    {
        // 重命名可能在日志落盘前已完成，因此依据受约束目录的实际存在状态恢复。
        if (!Directory.Exists(Previous))
        {
            if (!Directory.Exists(Plan.Target)) throw new IOException("原目录与备份均不存在，请保留事务目录并联系发布者。");
            if (PortablePackage.Verify(Plan.Target, null, CancellationToken.None) == Plan.PreviousDigest) { TryRecordRecovery(); return; }
            throw new IOException("没有可用旧版本备份。");
        }
        if (PortablePackage.Verify(Previous, null, CancellationToken.None) != Plan.PreviousDigest) throw new InvalidDataException("旧版本备份校验失败，已保留所有目录。");
        // 磁盘满或日志写入失败也必须先恢复旧目录，不能把日志成功作为恢复的前提。
        try { SetState("rolling-back"); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        if (Directory.Exists(Plan.Target))
        {
            if (Directory.Exists(Failed)) throw new IOException("已有故障目录，请保留并人工处理，未覆盖任何文件。");
            Directory.Move(Plan.Target, Failed);
        }
        Directory.Move(Previous, Plan.Target); TryRecordRecovery();
    }
    private void TryRecordRecovery() { try { SetState("rolled-back"); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    internal static Process Start(string executable, params string[] args)
    {
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = Path.GetDirectoryName(executable)! };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        return Process.Start(info) ?? throw new IOException("无法启动更新进程。");
    }

    // 工作进程只在原进程确实退出后取得跨进程文件锁；不强杀其他实例。
    internal static async Task<int> RunWorkerAsync(string directory, int pid, long started, bool rollback)
    {
        var transaction = Load(directory);
        var workerRoot = Path.Combine(transaction.Plan.Transaction, "worker");
        if (!string.Equals(PortablePackage.InstallationRoot(AppContext.BaseDirectory), workerRoot, StringComparison.OrdinalIgnoreCase)) throw new IOException("更新进程必须从隔离目录运行。");
        if (PortablePackage.Verify(workerRoot, null, CancellationToken.None) != transaction.Plan.PreviousDigest) throw new InvalidDataException("隔离恢复工具与原版本摘要不一致。");
        using var workerGate = new FileStream(Path.Combine(directory, "worker.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (!rollback) transaction.ValidateIncoming();
        if (pid > 0 && File.Exists(Path.Combine(directory, "handoff-cancelled"))) throw new IOException("主程序已取消更新交接。");
        transaction.SetState(rollback ? "rollback-ready" : "ready");
        if (pid > 0)
        {
            try
            {
                using var parent = Process.GetProcessById(pid);
                if (parent.StartTime.ToUniversalTime().Ticks != started) throw new IOException("原进程身份不匹配。");
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
                await parent.WaitForExitAsync(timeout.Token);
            }
            catch (ArgumentException) { /* 父进程已经退出。 */ }
        }
        if (pid > 0 && (!File.Exists(Path.Combine(directory, "authorized")) || File.Exists(Path.Combine(directory, "handoff-cancelled")))) throw new IOException("主程序未确认退出交接，更新已停止。");
        using var gate = Acquire(transaction.Plan.Target);
        PortablePackage.NoLinks(InstancePath(transaction.Plan.Target));
        using (var instances = new FileStream(InstancePath(transaction.Plan.Target), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        { if (rollback) transaction.Recover(); else transaction.Apply(); }
        var exe = PortablePackage.Executable(transaction.Plan.Target);
        Process launched;
        try { launched = rollback ? Start(exe) : Start(exe, "--updated", directory); }
        catch
        {
            if (!rollback)
            {
                transaction.Recover();
                // 尝试恢复旧版可用性；失败仍保留旧目录及外部恢复工具，不循环重启。
                try { using var old = Start(PortablePackage.Executable(transaction.Plan.Target)); } catch { }
            }
            throw;
        }
        using (launched)
        {
            if (rollback) return 0;
            // 仅启动失败或已退出的新进程可自动回滚；日志故障不能替换仍在使用的安装。
            for (var i = 0; i < 180; i++)
            {
                if (File.Exists(Path.Combine(directory, "healthy"))) { transaction.SetState("committed"); return 0; }
                if (launched.HasExited)
                {
                    transaction.Recover();
                    try { File.WriteAllText(Path.Combine(directory, "handoff-error.txt"), "新版本在编辑器就绪前退出，已恢复旧版本。请检查运行环境或保留此事务目录反馈给发布者。"); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                    using var old = Start(PortablePackage.Executable(transaction.Plan.Target)); return 1;
                }
                await Task.Delay(500);
            }
            return 0;
        }
    }
}
