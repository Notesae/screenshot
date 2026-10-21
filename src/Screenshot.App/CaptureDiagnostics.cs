using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App;

// 只记录固定阶段与耗时到本机最新日志；不含截图、窗口标题、路径、文档内容或服务凭据。
internal sealed class CaptureDiagnostics
{
    public static readonly AsyncLocal<CaptureDiagnostics?> Current=new();
    private static readonly SemaphoreSlim Writer=new(1,1);
    private static CaptureDiagnostics? _latest;
    private readonly Stopwatch _clock=Stopwatch.StartNew();
    private readonly List<object> _phases=new();
    private readonly DateTimeOffset _started=DateTimeOffset.UtcNow;
    public string? CaptureId { get; set; }
    public CaptureDiagnostics(){Volatile.Write(ref _latest,this);Current.Value=this;Mark("requested");}
    public void Mark(string phase,int? count=null){lock(_phases)if(_phases.Count<64)_phases.Add(new{phase,elapsedMs=Math.Round(_clock.Elapsed.TotalMilliseconds,2),count});}
    // 写盘在后台排队，只保留最近一次捕获；诊断失败不能阻止截图或抢占 UI 线程。
    public void Flush()=>_=Task.Run(async()=>{
        await Writer.WaitAsync();
        try
        {
            if(!ReferenceEquals(Volatile.Read(ref _latest),this))return;
            object[] phases;lock(_phases)phases=_phases.ToArray();
            var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Screenshot","diagnostics");Directory.CreateDirectory(folder);
            await File.WriteAllTextAsync(Path.Combine(folder,"capture-latest.json"),JsonSerializer.Serialize(new{build="capture-alpha-r5",startedUtc=_started,captureId=CaptureId,phases}));
        }
        catch(Exception error)when(error is IOException or UnauthorizedAccessException){/* 诊断写入不影响截图。 */}
        finally{Writer.Release();}
    });
}
