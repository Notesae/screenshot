using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Screenshot.App.Updates;

namespace Screenshot.App;

public partial class MainWindow
{
    // 更新前只检查异步任务和未提交文字；遵循用户要求，不自动保存编辑内容。
    private async Task<bool> SaveBeforeUpdateAsync()
    {
        if (!_ready || Editor.CoreWebView2 is null) throw new IOException("编辑器尚未就绪，暂不能安装更新。");
        using var result = JsonDocument.Parse(await Editor.CoreWebView2.ExecuteScriptAsync("window.screenshotPrepareUpdate?.() ?? null"));
        var value = result.RootElement;
        if (value.ValueKind != JsonValueKind.Object) throw new IOException("编辑器未提供操作状态，已阻止退出。");
        if (value.TryGetProperty("error", out var error)) throw new IOException(error.GetString());
        return true;
    }
    // 只有本地 React 已挂载并主动报告就绪，才确认本次重启健康；条款界面不算编辑器就绪。
    private void MarkUpdateHealthy()
    {
        if (App.UpdateDirectory is not { } directory) return;
        var transaction = UpdateTransaction.Load(directory);
        if (!string.Equals(transaction.Plan.Target.TrimEnd(Path.DirectorySeparatorChar), App.InstallationDirectory, StringComparison.OrdinalIgnoreCase)) throw new IOException("更新健康确认目标无效。");
        File.WriteAllText(Path.Combine(directory, "healthy"), "ready");
    }
}
