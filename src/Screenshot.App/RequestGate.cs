using System;
using System.Threading;

namespace Screenshot.App;

// AI 和本地操作分别互斥；纯读取不占门控，耗时 AI 不阻塞本地编辑流程。
internal sealed class RequestGate
{
    private readonly object _sync = new();
    private bool _nativeBusy;
    private bool _aiBusy;

    // 成功取得对应操作的租约，由调用方在 finally 中释放。
    public bool TryEnter(string method, out IDisposable? lease)
    {
        lease = null;
        // 恢复存储有自己的事务队列；取消和状态查询必须绕过等待中的推理请求。
        if (method is "app.info" or "settings.read" or "presentation.ready" or "presentation.workbench" or "presentation.dismiss"
            or "ai.cancel" or "ai.usage" or "ocr.status" or "ocr.cancel" or "capture.settings" or "capture.configure"
            or "recovery.usage" or "recovery.deleteMany" or "recovery.save" or "recovery.list" or "recovery.load" or "recovery.delete") return true;
        var ai = method is "ai.ocr" or "ai.translate" or "ai.test" or "ocr.local";
        lock (_sync)
        {
            if (ai ? _aiBusy : _nativeBusy) return false;
            if (ai) _aiBusy = true; else _nativeBusy = true;
            lease = new Lease(this, ai);
            return true;
        }
    }

    private void Release(bool ai)
    {
        lock (_sync) { if (ai) _aiBusy = false; else _nativeBusy = false; }
    }

    // 租约仅释放一次，防止重复 Dispose 意外解锁后续请求。
    private sealed class Lease(RequestGate owner, bool ai) : IDisposable
    {
        private RequestGate? _owner = owner;
        public void Dispose() => Interlocked.Exchange(ref _owner, null)?.Release(ai);
    }
}
