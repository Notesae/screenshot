using System;
using System.Threading.Tasks;

namespace Screenshot.App;

/// <summary>等上一条通知实际关闭后只展示最后一个意图；截图和退出可作废排队提示。</summary>
internal sealed class NativeNoticeSequence
{
    private long _version;
    public void Cancel() => _version++;
    public async Task<bool> ReplaceAsync(Func<Task> closePrevious, Action show)
    {
        var version = ++_version;
        // 保留调用方上下文，真正展示通知仍回到 WPF 界面线程。
        await closePrevious();
        if (version != _version) return false;
        show(); return true;
    }
}
