using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Screenshot.App.Updates;

namespace Screenshot.App;

public partial class MainWindow
{
    // 设置对话框阻止编辑；仍有异步任务或正在编辑文字时拒绝安装，快照持久化失败则保持应用打开。
    private async Task<bool> SaveBeforeUpdateAsync()
    {
        if (!_ready || Editor.CoreWebView2 is null) throw new IOException("编辑器尚未就绪，无法安全保存当前项目。");
        using var result = JsonDocument.Parse(await Editor.CoreWebView2.ExecuteScriptAsync("window.screenshotPrepareUpdate?.() ?? null"));
        var value = result.RootElement;
        if (value.ValueKind != JsonValueKind.Object) throw new IOException("编辑器未提供安全保存状态，已阻止退出。");
        if (value.TryGetProperty("error", out var error)) throw new IOException(error.GetString());
        if (value.TryGetProperty("empty", out var empty) && empty.ValueKind == JsonValueKind.True) return true;
        // 独立恢复身份避免已自动保存的相同修订被存储层当成旧写入；原项目记录保持可用。
        var saved = await RunRecoveryAsync(store => store.SaveAsync(Guid.NewGuid().ToString("N"), value.GetProperty("revision").GetInt64(), value.GetProperty("document").Clone(), _lifetime.Token));
        if (!saved.Saved || saved.Stale) throw new IOException("更新前快照未保存成功，已阻止退出。请先手动保存项目再重试。");
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
