using System;
using System.Windows;
using System.IO;
using System.Reflection;
using Screenshot.App.Updates;

namespace Screenshot.App;
// WPF 启动入口，并为未处理的界面异常提供可见错误反馈。
public partial class App : Application
{
    internal static string? UpdateDirectory { get; private set; }
    // 文件锁、更新事务与健康确认共用发行根目录，编辑器及条款仍从宿主目录读取。
    internal static string InstallationDirectory => PortablePackage.InstallationRoot(AppContext.BaseDirectory);
    private FileStream? _instanceLease;
    // 注册界面异常处理后启动主窗口，避免操作失败导致无提示退出。
    protected override async void OnStartup(StartupEventArgs e)
    {
        // 更新工作进程在条款、窗口、WebView、托盘及全局热键初始化之前分流。
        if (e.Args.Length > 0 && e.Args[0] is "--apply-update" or "--rollback-update" or "--recover-update")
        {
            try
            {
                var recovery = e.Args[0] == "--recover-update";
                if ((!recovery && e.Args.Length != 4) || (recovery && e.Args.Length != 2)) throw new InvalidDataException("更新参数无效。");
                var code = await UpdateTransaction.RunWorkerAsync(e.Args[1], recovery ? 0 : int.Parse(e.Args[2]), recovery ? 0 : long.Parse(e.Args[3]), e.Args[0] != "--apply-update");
                Shutdown(code);
            }
            catch (Exception error)
            {
                // 后台失败不弹窗、不启动编辑器；恢复工具将可操作原因写到原事务目录。
                try { var tx = UpdateTransaction.Load(e.Args[1]); File.WriteAllText(Path.Combine(tx.Plan.Transaction, "handoff-error.txt"), error.ToString()); if (!Directory.Exists(tx.Previous) && Directory.Exists(tx.Plan.Target) && tx.State != "rolled-back") tx.SetState("aborted"); } catch { }
                Shutdown(1);
            }
            return;
        }
        if (e.Args.Length == 2 && e.Args[0] == "--updated") UpdateDirectory = e.Args[1];
        DispatcherUnhandledException += (_, args) =>
        {
            MessageBox.Show("操作失败，请重试。\n" + args.Exception.Message, "Screenshot", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
        base.OnStartup(e);
        var startupStep = "检查发行目录";
        try
        {
            var instancePath = UpdateTransaction.InstancePath(InstallationDirectory);
            PortablePackage.NoLinks(instancePath);
            // 只读安装仍可正常启动；更新时会明确拒绝原地写入并提供并排导出。
            try { _instanceLease = new FileStream(instancePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            startupStep = "读取使用条款";
            var agreement = TermsAgreement.Load(AppContext.BaseDirectory);
            var store = new TermsAcceptanceStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot", "terms-acceptance.json"));
            var startup = new TermsStartup(agreement, store, Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "unknown");
            startupStep = "显示使用条款";
            if (!startup.IsAuthorized && new TermsWindow(startup).ShowDialog() != true) { Shutdown(); return; }
            // 创建宿主的唯一入口位于同意门禁之后；启动拒绝不会注册热键或初始化服务。
            startupStep = "创建截图入口";
            if (!startup.Start(() => { MainWindow = Screenshot.App.MainWindow.Create(startup); ShutdownMode = ShutdownMode.OnMainWindowClose; })) { Shutdown(); return; }
            await ((Screenshot.App.MainWindow)MainWindow).StartInTrayAsync();
        }
        catch (Exception error)
        {
            MessageBox.Show("启动失败（" + startupStep + "）。请完整解压下载包，再运行根目录 Screenshot.exe。\n" + error.Message, "Screenshot", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
    protected override void OnExit(ExitEventArgs e) { _instanceLease?.Dispose(); base.OnExit(e); }
}
