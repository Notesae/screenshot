using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App.Updates;

// 每个设置会话仅保留一个已验证候选；关闭或取消不会触碰当前安装。
internal sealed class UpdateSession : IDisposable
{
    internal readonly GitHubUpdateSource Source;
    internal string Target { get; }
    internal ReleaseVersion Current { get; }
    internal UpdateRelease? Release { get; set; }
    internal string? Downloaded { get; private set; }
    internal string? Extracted { get; private set; }
    private string? _workspace;
    internal UpdateTransaction? Transaction { get; private set; }
    private FileStream? _gate;
    internal UpdateSession(string target, ReleaseVersion current, GitHubUpdateSource? source = null)
    { Target = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar); Current = current; Source = source ?? new(); }

    internal async Task DownloadAsync(IProgress<UpdateProgress> progress, CancellationToken token)
    {
        var release = Release ?? throw new InvalidOperationException("请先检查新版本。");
        if (release.Version.CompareTo(Current) <= 0) throw new InvalidOperationException("拒绝重复安装或降级。");
        _gate ??= UpdateTransaction.Acquire(Target);
        ClearDownload();
        _workspace = Path.Combine(Path.GetTempPath(), "Screenshot-update-" + Guid.NewGuid().ToString("N"));
        PortablePackage.NoLinks(_workspace); Directory.CreateDirectory(_workspace);
        var zip = Path.Combine(_workspace, "package.zip"); var extracted = Path.Combine(_workspace, "package");
        try
        {
            await Source.DownloadAsync(release, zip, progress, token);
            progress.Report(new(release.Size, release.Size, "verifying"));
            await Task.Run(() => PortablePackage.Extract(zip, extracted, release.Version, token), token);
            Downloaded = zip; Extracted = extracted;
        }
        catch { ClearDownload(); _gate.Dispose(); _gate = null; throw; }
    }
    internal async Task<UpdateTransaction> PrepareAsync(CancellationToken token)
    {
        var release = Release ?? throw new InvalidOperationException("请先检查新版本。");
        if (Extracted is null || Downloaded is null) throw new InvalidOperationException("请先下载并验证更新。");
        if (release.Version.CompareTo(Current) <= 0 || PortablePackage.Digest(Downloaded) != release.Sha256) throw new InvalidDataException("候选更新已改变，请重新下载。");
        return await Task.Run(() =>
        {
            var previous = UpdateTransaction.Find(Target);
            if (previous is not null && previous.State is not ("committed" or "rolled-back" or "prepared" or "aborted")) throw new IOException("上次更新尚未完成，请先使用回滚或事务目录内的恢复工具处理。");
            var before = PortablePackage.Verify(Target, null, token);
            var required = Directory.EnumerateFiles(Target, "*", SearchOption.AllDirectories).Sum(p => new FileInfo(p).Length)
                + Directory.EnumerateFiles(Extracted, "*", SearchOption.AllDirectories).Sum(p => new FileInfo(p).Length) + 64L * 1024 * 1024;
            if (new DriveInfo(Path.GetPathRoot(Target)!).AvailableFreeSpace < required) throw new IOException("安装盘空间不足以同时保存新包和隔离恢复工具。请腾出空间或解压到另一磁盘的新目录。");
            var directory = Path.Combine(Path.GetDirectoryName(Target)!, ".screenshot-update-" + Guid.NewGuid().ToString("N"));
            PortablePackage.NoLinks(directory); Directory.CreateDirectory(directory);
            var staged = Path.Combine(directory, "package");
            PortablePackage.CopyVerified(Extracted, staged, token);
            var digest = PortablePackage.Verify(staged, release.Version, token);
            var transaction = new UpdateTransaction(new(Target, directory, release.Version.ToString(), digest, before));
            // 复制当前完整运行时，让辅助进程不再占用需要重命名的安装目录。
            PortablePackage.CopyVerified(Target, Path.Combine(directory, "worker"), token);
            transaction.Save(); Transaction = transaction; return transaction;
        }, token);
    }
    internal async Task HandOffAsync(UpdateTransaction transaction, bool rollback)
    {
        _gate ??= UpdateTransaction.Acquire(Target);
        using var current = Process.GetCurrentProcess();
        var exe = Path.Combine(transaction.Plan.Transaction, "worker", "Screenshot.exe");
        var signal = Path.Combine(transaction.Plan.Transaction, "handoff-error.txt");
        if (File.Exists(signal)) File.Delete(signal);
        var authorization = Path.Combine(transaction.Plan.Transaction, "authorized");
        if (File.Exists(authorization)) File.Delete(authorization);
        var cancelled = Path.Combine(transaction.Plan.Transaction, "handoff-cancelled");
        if (File.Exists(cancelled)) File.Delete(cancelled);
        transaction.SetState(rollback ? "rollback-starting" : "starting");
        using var worker = UpdateTransaction.Start(exe, rollback ? "--rollback-update" : "--apply-update", transaction.Plan.Transaction,
            current.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), current.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture));
        var expected = rollback ? "rollback-ready" : "ready";
        for (var i = 0; i < 120; i++)
        {
            if (transaction.State == expected) { File.WriteAllText(authorization, "confirmed"); _gate?.Dispose(); _gate = null; return; }
            if (worker.HasExited || File.Exists(signal)) { File.WriteAllText(cancelled, "cancelled"); transaction.SetState("aborted"); throw new IOException("更新辅助进程启动失败；应用未退出。请保留事务目录并查看恢复说明：" + transaction.Plan.Transaction); }
            await Task.Delay(500);
        }
        // 不退出；工作进程的父进程等待会超时，因此它不能替换仍在使用的目录。
        File.WriteAllText(cancelled, "cancelled"); transaction.SetState("aborted");
        throw new IOException("更新辅助进程未及时就绪，应用保持打开。请稍后重试，或按事务目录中的恢复说明处理。");
    }
    internal void ExportTo(string destination, CancellationToken token)
    {
        if (Extracted is null || Release is null) throw new InvalidOperationException("请先下载并校验。");
        var full = Path.GetFullPath(destination);
        if (Directory.Exists(full) || File.Exists(full)) throw new IOException("请选择尚不存在的新目录，不能覆盖现有文件。");
        var temporary = full + ".partial-" + Guid.NewGuid().ToString("N");
        PortablePackage.CopyVerified(Extracted, temporary, token);
        PortablePackage.Verify(temporary, Release.Version, token); token.ThrowIfCancellationRequested();
        Directory.Move(temporary, full);
    }
    internal void ReleaseGate() { _gate?.Dispose(); _gate = null; }
    internal void Invalidate() { Release = null; try { ClearDownload(); } finally { ReleaseGate(); } }
    private void ClearDownload()
    {
        Downloaded = null; Extracted = null;
        if (_workspace is not null && Directory.Exists(_workspace))
        {
            // 只清理本会话创建的 GUID 临时目录，遇到重解析点则保留供人工处理。
            PortablePackage.NoLinks(_workspace);
            if (!Path.GetFullPath(_workspace).StartsWith(Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(_workspace), "^Screenshot-update-[a-f0-9]{32}$")) throw new IOException("临时目录边界无效，未清理文件。");
            foreach (var path in Directory.EnumerateFileSystemEntries(_workspace, "*", SearchOption.AllDirectories)) PortablePackage.NoLinks(path);
            Directory.Delete(_workspace, true);
        }
        _workspace = null;
    }
    public void Dispose() { ReleaseGate(); Source.Dispose(); try { ClearDownload(); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
}
