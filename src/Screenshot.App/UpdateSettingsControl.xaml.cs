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
    private readonly UpdateSession _session = new(AppContext.BaseDirectory, ReleaseVersion.Parse(typeof(App).Assembly.GetName().Version!.ToString(3)));
    private CancellationTokenSource? _operation;
    private bool _busy, _disposed;
    internal Func<Task<bool>>? SaveBeforeExit { get; set; }
    public UpdateSettingsControl()
    {
        InitializeComponent(); CurrentVersion.Text = "当前版本：" + _session.Current + " · Windows x64 便携版";
        UpdateStatus.Text = "尚未检查。私有仓库需要发布者先提供可访问的官方渠道；本应用不读取 GitHub 凭据。";
        RefreshRecovery();
    }
    private void RefreshRecovery()
    {
        try
        {
            var transaction = UpdateTransaction.Find(_session.Target);
            RollbackButton.IsEnabled = !_busy && transaction is not null && Directory.Exists(transaction.Previous);
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
        if (_busy || _disposed) return; _busy = true; _operation = new();
        CheckButton.IsEnabled = DownloadButton.IsEnabled = InstallButton.IsEnabled = ExportButton.IsEnabled = RollbackButton.IsEnabled = Channel.IsEnabled = false;
        CancelButton.IsEnabled = true;
        try { await action(_operation.Token); }
        catch (OperationCanceledException) { UpdateStatus.Text = "操作已取消，当前安装未替换。可重新下载或检查。"; }
        catch (Exception e) { UpdateStatus.Text = "更新未完成：" + e.Message; }
        finally
        {
            _operation.Dispose(); _operation = null; _busy = false; Progress.IsIndeterminate = false;
            if (_disposed) _session.Dispose();
            if (!_disposed)
            {
                CheckButton.IsEnabled = Channel.IsEnabled = true; CancelButton.IsEnabled = false;
                DownloadButton.IsEnabled = _session.Release is not null;
                DownloadButton.Content = _session.Downloaded is null ? "下载更新 / 重试" : "重新下载";
                InstallButton.IsEnabled = ExportButton.IsEnabled = _session.Extracted is not null && _session.Release is not null; RefreshRecovery();
            }
        }
    }
    private async void Check_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        _session.Invalidate(); LatestVersion.Text = ""; ReleaseNotes.Text = "";
        Progress.IsIndeterminate = true; UpdateStatus.Text = "正在检查官方版本…";
        var release = await _session.Source.CheckAsync(_session.Current, Channel.SelectedIndex == 1, token);
        _session.Release = release;
        LatestVersion.Text = release is null ? "当前通道没有更高版本。" : $"最新版本：{release.Version} · {(release.Preview ? "预发布" : "稳定版")} · {release.Size / 1048576.0:F1} MiB";
        ReleaseNotes.Text = release?.Notes ?? ""; UpdateStatus.Text = release is null ? "检查完成。" : "可下载新版本；下载完成后还需明确确认安装。";
    });
    private async void Download_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        Progress.Value = 0; UpdateStatus.Text = "正在下载，完成后解压并验证全部文件…";
        var progress = new Progress<UpdateProgress>(p => { if (_disposed) return; Progress.IsIndeterminate = p.Phase == "verifying"; if (p.Phase == "verifying") UpdateStatus.Text = "下载完成，正在解压并校验全部文件…"; Progress.Value = p.Received * 100.0 / p.Total; ProgressText.Text = $"{p.Received / 1048576.0:F1} / {p.Total / 1048576.0:F1} MiB"; });
        await _session.DownloadAsync(progress, token); UpdateStatus.Text = "下载与完整性校验通过。可以安装，或解压到新的便携目录。";
    });
    private async void Install_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        var owner = Window.GetWindow(this);
        if (MessageBox.Show(owner, "将保存当前编辑到本机恢复库，然后关闭 Screenshot、替换便携目录并重启。未保存项目可在重启后从恢复记录打开。旧版本保留用于回滚。继续安装？", "安装并重启", MessageBoxButton.OKCancel, MessageBoxImage.Question, MessageBoxResult.Cancel) != MessageBoxResult.OK) return;
        UpdateStatus.Text = "正在准备隔离更新目录与旧版恢复工具…"; Progress.IsIndeterminate = true;
        var transaction = await _session.PrepareAsync(token); token.ThrowIfCancellationRequested();
        if (SaveBeforeExit is null || !await SaveBeforeExit()) throw new IOException("当前编辑未能安全保存，已阻止退出。");
        token.ThrowIfCancellationRequested(); CancelButton.IsEnabled = false;
        await _session.HandOffAsync(transaction, false); Application.Current.Shutdown();
    });
    private async void Rollback_Click(object sender, RoutedEventArgs e) => await RunAsync(async token =>
    {
        var transaction = UpdateTransaction.Find(_session.Target) ?? throw new IOException("未找到旧版本备份。");
        if (MessageBox.Show(Window.GetWindow(this), "将保存当前编辑，关闭并恢复上一版本；当前版本目录保留为故障备份。继续？", "回滚并重启", MessageBoxButton.OKCancel, MessageBoxImage.Question, MessageBoxResult.Cancel) != MessageBoxResult.OK) return;
        if (SaveBeforeExit is null || !await SaveBeforeExit()) throw new IOException("当前编辑未能安全保存，已阻止回滚。");
        CancelButton.IsEnabled = false;
        await _session.HandOffAsync(transaction, true); Application.Current.Shutdown();
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
    private void Cancel_Click(object sender, RoutedEventArgs e) => _operation?.Cancel();
    private void Channel_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (CheckButton is null || _busy) return;
        _session.Invalidate(); DownloadButton.IsEnabled = InstallButton.IsEnabled = ExportButton.IsEnabled = false;
        LatestVersion.Text = ""; ReleaseNotes.Text = ""; UpdateStatus.Text = "通道已切换，请重新检查。";
    }
    public void Dispose() { _disposed = true; _operation?.Cancel(); if (!_busy) _session.Dispose(); }
}
