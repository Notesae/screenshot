using System;
using System.Collections.Generic;
using System.Threading;

namespace Screenshot.App;
// 取消只命中请求自己的 ID；迟到取消不能终止随后启动的新任务。
internal sealed class InferenceTasks
{
    private readonly object _sync=new();
    private readonly Dictionary<string,CancellationTokenSource> _active=new();
    public Lease Begin(string id,CancellationToken lifetime)
    {
        if(id.Length is <1 or >100)throw new InvalidOperationException("AI 任务标识无效。");
        foreach(var c in id)if(!char.IsAsciiLetterOrDigit(c)&&c!='-')throw new InvalidOperationException("AI 任务标识无效。");
        lock(_sync){if(_active.ContainsKey(id))throw new InvalidOperationException("AI 任务标识重复。");var source=CancellationTokenSource.CreateLinkedTokenSource(lifetime);_active.Add(id,source);return new(this,id,source);}
    }
    public bool Cancel(string id)
    {
        CancellationTokenSource? source;lock(_sync){_active.TryGetValue(id,out source);}
        if(source is null)return false;
        try{source.Cancel();return true;}catch(ObjectDisposedException){return false;}
    }
    internal sealed class Lease(InferenceTasks owner,string id,CancellationTokenSource source):IDisposable
    {
        private int _disposed;
        public CancellationToken Token=>source.Token;
        public void Dispose(){if(Interlocked.Exchange(ref _disposed,1)!=0)return;lock(owner._sync){owner._active.Remove(id);}source.Dispose();}
    }
}
