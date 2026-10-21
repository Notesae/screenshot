using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using Screenshot.App.Updates;

namespace Screenshot.App;

// 更新的网络、磁盘和进程能力全部留在 WPF 宿主；关闭设置会取消仍在下载的请求。
public partial class UpdateSettingsControl : UserControl, IDisposable
{
    private readonly UpdateSession _session;
    // MSI 管理的文件必须经 MSI 升级，避免便携更新绕开安装器的修复和卸载记录。
    private readonly bool _installedWithMsi;
    private CancellationTokenSource? _operation;
    private bool _busy, _disposed, _handoff;
    private long _generation;
    internal Func<Task<bool>>? SaveBeforeExit { get; set; }
    // 交接期间必须保持设置的模态保护，不能在快照保存后重新开放主窗口编辑。
    internal bool RequestClose()
    {
        if (!_handoff) return true;
        UpdateStatus.Text = "正在交接更新并等待重启，请稍候。交接结束或失败后可关闭设置。";
        return false;
    }
    internal UpdateSettingsControl()
    {
        _session = new(App.InstallationDirectory, ReleaseVersion.Parse(typeof(App).Assembly.GetName().Version!.ToString(3)), new GitHubUpdateSource());
        var installedDirectory = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Notesae\Screenshot", "InstallDirectory", null) as string;
        _installedWithMsi = installedDirectory is not null && string.Equals(Path.TrimEndingDirectorySeparator(installedDirectory), _session.Target, StringComparison.OrdinalIgnoreCase);
        InitializeComponent(); CurrentVersion.Text = "当前版本：" + _session.Current + (_installedWithMsi ? " · Windows x64 安装版（升级请运行新版 MSI）" : " · Windows x64 便携版");
        UpdateStatus.Text = "点击“检查更新”获取新版本。";
        RefreshRecovery();
    }
    private void RefreshRecovery()
    {
        try
        {
            var transaction = UpdateTransaction.Find(_session.Target);
            RollbackButton.IsEnabled = !_installedWithMsi && !_busy && transaction is not null && Directory.Exists(transaction.Previous);
            RecoveryInfo.Text = transaction is null ? "" : $"上次更新：{transaction.State}。备份和恢复说明：{transaction.Plan.Transaction}";
            if (transaction is not null)
            {
                var errorPath = Path.Combine(transaction.Plan.Transaction, "handoff-error.txt");
                if (File.Exists(errorPath) && new FileInfo(errorPath).Length <= 32000) RecoveryInfo.Text += "\n上次失败：" + File.ReadAllText(errorPath);
            }
        }
        catch (Exception e) { RecoveryInfo.Text = "更新记录不可读，请保留安装旁的事务目录：" + e.Message; }
    }
    // UI 事件统一门控；取消只中断准备阶段，目录切换开始后不提供不安全的取消按钮。
    private async Task RunAsync(Func<CancellationToken, Task> action)
    {
        if (_busy || _disposed) return; _busy = true; _operation = new(); _generation++;
        CheckButton.IsEnabled = DownloadButton.IsEnabled = InstallButton.IsEnabled = ExportButton.IsEnabled = RollbackButton.IsEnabled = Channel.IsEnabled = false;
        CancelButton.IsEnabled = true;
        try { await action(_operation.Token); }
        catch (OperationCanceledException) { UpdateStatus.Text = "操作已取消，当前安装未替换。可重新检查或下载。"; }
        catch (Exception e) { UpdateStatus.Text = "更新未完成：" + e.Message; }
        finally
        {
            _operation.Dispose(); _operation = null; _busy = _handoff = false; Progress.IsIndeterminate = false;
            DownloadProgress.Visibility = Visibility.Collapsed;
            if (_disposed) _session.Dispose();
            if (!_disposed)
            {
                Channel.IsEnabled = true; CancelButton.IsEnabled = false; CheckButton.IsEnabled = true;
                DownloadButton.IsEnabled = _session.Release is not null;
                DownloadButton.Content = _session.Downloaded is null ? "下载更新 / 重试" : "重新下载";
                ExportButton.IsEnabled = _session.Extracted is not null && _session.Release is not null;
                InstallButton.IsEnabled = !_installedWithMsi && ExportButton.IsEnabled; RefreshRecovery();
            }
        }
    }
    // 清理失败仍作废候选并释放锁；保留临时目录供手动处理，不让异步 UI 事件崩溃。
    private void ClearCandidate()
    {
        _generation++; Progress.Value = 0; ProgressText.Text = "";
        ReleaseDetails.Visibility = DownloadProgress.Visibility = Visibility.Collapsed;
        LatestVersion.Text = ""; ReleaseNotes.Text = ""; DownloadButton.IsEnabled = InstallButton.IsEnabled = ExportButton.IsEnabled = false;
        try { _session.Invalidate(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { UpdateStatus.Text = "候选已作废，临时下载目录未能完全移除，请关闭应用后清理本机 Screenshot-update 临时目录。"; }
    }
    private async void Check_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        ClearCandidate();
        UpdateStatus.Text = "正在检查更新…";
        var release = await _session.Source.CheckAsync(_session.Current, Channel.SelectedIndex == 1, token);
        _session.Release = release;
        LatestVersion.Text = release is null ? "" : $"最新版本：{release.Version} · {(release.Preview ? "预发布" : "稳定版")} · {release.Size / 1048576.0:F1} MiB";
        // 无候选时只留状态文字；有候选但没有说明时给出明确文案，不展示空输入框。
        ReleaseDetails.Visibility = release is null ? Visibility.Collapsed : Visibility.Visible;
        ReleaseNotes.Text = string.IsNullOrWhiteSpace(release?.Notes) ? "此版本未提供更新说明。" : release.Notes;
        UpdateStatus.Text = release is null ? (Channel.SelectedIndex == 0 && _session.Source.HasPreviewReleases && !_session.Source.HasStableReleases ? "暂无稳定版，可切换到预发布通道后重新检查。" : "已是当前通道的最新版本。") : "发现新版本，下载后可选择安装。";
    });
    private async void Download_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        // 下载开始才揭示细进度条，完成、失败或取消统一由操作出口收起。
        DownloadProgress.Visibility = Visibility.Visible;
        Progress.IsIndeterminate = false; Progress.Value = 0; ProgressText.Text = "正在准备下载…";
        UpdateStatus.Text = "正在下载，完成后解压并验证全部文件…";
        // Dispatcher 中迟到的进度不能覆盖取消结果、通道切换或下一笔操作。
        var generation = _generation;
        var progress = new Progress<UpdateProgress>(p => { if (_disposed || !_busy || token.IsCancellationRequested || generation != _generation) return; Progress.IsIndeterminate = p.Phase == "verifying"; if (p.Phase == "verifying") UpdateStatus.Text = "下载完成，正在解压并校验全部文件…"; Progress.Value = p.Received * 100.0 / p.Total; ProgressText.Text = $"{p.Received / 1048576.0:F1} / {p.Total / 1048576.0:F1} MiB"; });
        await _session.DownloadAsync(progress, token); UpdateStatus.Text = "下载与完整性校验通过。可以安装，或解压到新的便携目录。";
    });
    private async void Install_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        if (_installedWithMsi) throw new InvalidOperationException("安装版请从官方 Release 下载新版 MSI 进行升级；也可以将便携包解压到其他新目录。");
        var owner = Window.GetWindow(this);
        if (SoftClayDialog.Show(owner, "将关闭 Screenshot、替换便携目录并重启，不会自动保存当前编辑。需要保留时请先取消并手动保存项目。旧版本会保留用于回滚。继续安装？", "安装并重启", MessageBoxButton.OKCancel, MessageBoxImage.Question, MessageBoxResult.Cancel) != MessageBoxResult.OK) return;
        UpdateStatus.Text = "正在准备隔离更新目录与旧版恢复工具…"; Progress.IsIndeterminate = true;
        var transaction = await _session.PrepareAsync(token); token.ThrowIfCancellationRequested();
        if (SaveBeforeExit is null || !await SaveBeforeExit()) throw new IOException("当前编辑未能安全保存，已阻止退出。");
        token.ThrowIfCancellationRequested(); CancelButton.IsEnabled = false;
        _handoff = true;
        await _session.HandOffAsync(transaction, false); _handoff = false; ShutdownAfterSavedHandoff();
    });
    private async void Rollback_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        if (_installedWithMsi) throw new InvalidOperationException("安装版请使用系统卸载和 MSI 重新安装，不执行便携目录回滚。");
        var transaction = UpdateTransaction.Find(_session.Target) ?? throw new IOException("未找到旧版本备份。");
        if (SoftClayDialog.Show(Window.GetWindow(this), "将关闭并恢复上一版本，不会自动保存当前编辑。需要保留时请先取消并手动保存项目。当前版本目录会保留为故障备份。继续回滚？", "回滚并重启", MessageBoxButton.OKCancel, MessageBoxImage.Question, MessageBoxResult.Cancel) != MessageBoxResult.OK) return;
        if (SaveBeforeExit is null || !await SaveBeforeExit()) throw new IOException("当前编辑未能安全保存，已阻止回滚。");
        token.ThrowIfCancellationRequested(); CancelButton.IsEnabled = false;
        _handoff = true;
        await _session.HandOffAsync(transaction, true); _handoff = false; ShutdownAfterSavedHandoff();
    });
    private async void Export_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        // 选择一个父目录，再生成独立版本目录；从不合并覆盖用户目录。
        var dialog = new OpenFolderDialog { Title = "选择新便携目录的上级文件夹" };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        var destination = Path.Combine(dialog.FolderName, "Screenshot-" + _session.Release!.Version + "-win-x64");
        await Task.Run(() => _session.ExportTo(destination, token), token);
        UpdateStatus.Text = "已验证并解压到：" + destination + "。先保存项目并关闭当前应用，再运行新目录的 Screenshot.exe；本机设置和恢复库沿用原位置。";
    });
    private static void ShutdownAfterSavedHandoff()
    {
        if (Application.Current.MainWindow is MainWindow editor) editor.AllowSavedShutdown();
        Application.Current.Shutdown();
    }
    private void Cancel_Click(object sender, RoutedEventArgs e) => _operation?.Cancel();
    private void Channel_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (CheckButton is null || _busy) return;
        ClearCandidate(); UpdateStatus.Text = "通道已切换，请重新检查。";
    }
    public void Dispose() { _disposed = true; _operation?.Cancel(); if (!_busy) _session.Dispose(); }
}
