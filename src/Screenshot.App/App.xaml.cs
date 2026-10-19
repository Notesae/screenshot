using System;
using System.Windows;

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
    }
}
