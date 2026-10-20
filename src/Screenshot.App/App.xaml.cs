using System;
using System.Windows;
using System.IO;
using System.Reflection;

namespace Screenshot.App;
// WPF 启动入口，并为未处理的界面异常提供可见错误反馈。
public partial class App : Application
{
    // 注册界面异常处理后启动主窗口，避免操作失败导致无提示退出。
    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += (_, args) =>
        {
            MessageBox.Show("操作失败，请重试。\n" + args.Exception.Message, "Screenshot", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
        base.OnStartup(e);
        try
        {
            var agreement = TermsAgreement.Load(AppContext.BaseDirectory);
            var store = new TermsAcceptanceStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot", "terms-acceptance.json"));
            var startup = new TermsStartup(agreement, store, Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "unknown");
            if (!startup.IsAuthorized && new TermsWindow(startup).ShowDialog() != true) { Shutdown(); return; }
            // 创建宿主的唯一入口位于同意门禁之后；启动拒绝不会注册热键或初始化服务。
            if (!startup.Start(() => { MainWindow = Screenshot.App.MainWindow.Create(startup); MainWindow.Show(); ShutdownMode = ShutdownMode.OnMainWindowClose; })) Shutdown();
        }
        catch (Exception error)
        {
            MessageBox.Show("无法校验或读取使用条款，应用未启动。请使用完整发行目录。\n" + error.Message, "Screenshot", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
}
