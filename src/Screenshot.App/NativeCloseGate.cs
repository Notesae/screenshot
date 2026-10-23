using System;

namespace Screenshot.App;

internal enum NativeCloseDecision { Immediate, StartExit, Hold, Cancelled }

/// <summary>Closing 可取消且可能重复；代次隔离旧回调，并保留模态窗口的明确结果。</summary>
internal sealed class NativeCloseGate
{
    public long Version { get; private set; }
    public bool Pending { get; private set; }
    public bool Committing { get; private set; }
    public bool? DialogResult { get; private set; }
    public NativeCloseDecision Request(bool cancelled, bool animate, bool? dialogResult)
    {
        if (cancelled) { Cancel(); return NativeCloseDecision.Cancelled; }
        if (Committing) return NativeCloseDecision.Immediate;
        if (Pending) return NativeCloseDecision.Hold;
        if (!animate) return NativeCloseDecision.Immediate;
        Version++; Pending = true; DialogResult = dialogResult;
        return NativeCloseDecision.StartExit;
    }
    public bool TryCommit(long version)
    {
        if (!Pending || Committing || Version != version) return false;
        Committing = true; return true;
    }
    public void Cancel() { Version++; Pending = Committing = false; DialogResult = null; }
}

/// <summary>托盘命令等到实际 Closed；重开作废旧意图，重复通知只能执行一次。</summary>
internal sealed class DeferredNativeAction
{
    private Action? _action;
    private long _version;
    public void Set(Action action) { _version++; _action = action; }
    public void Cancel() { _version++; _action = null; }
    public Action? Take()
    {
        var action = _action; var version = _version; _action = null;
        return action is null ? null : () => { if (version == _version) { _version++; action(); } };
    }
}
