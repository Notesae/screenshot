using System;
using System.ComponentModel;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace Screenshot.App;

// 等待 WebView 模板图像的真实缓冲区更新；普通 WPF Rendering 或网页 RAF 不代表已收到浏览器画面。
internal static class CompositionFrameWaiter
{
    public static async Task WaitAsync(Image image,Func<Task> invalidate,CancellationToken token,Func<ImageSource,bool>? acceptFrame=null)
    {
        var frame=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var descriptor=DependencyPropertyDescriptor.FromProperty(Image.SourceProperty,typeof(Image));
        ImageSource? observed=null;
        var queued=false;var finished=false;var invalidated=false;
        // 在 SDK 的 Unlock/Source setter 返回之后读样本；排在渲染后执行，避免低优先级队列被持续输入饿死。
        void Changed(object? sender,EventArgs args)
        {
            if(queued||finished)return;queued=true;
            image.Dispatcher.BeginInvoke(DispatcherPriority.Loaded,new Action(()=>{
                queued=false;if(finished||token.IsCancellationRequested||acceptFrame is not null&&!invalidated)return;
                try{if(image.Source is {} source&&(acceptFrame is null||acceptFrame(source)))frame.TrySetResult();}
                catch(Exception error){frame.TrySetException(error);}
            }));
        }
        void SourceChanged(object? sender,EventArgs args)
        {
            if(observed is {IsFrozen:false})observed.Changed-=Changed;
            observed=image.Source;
            if(observed is {IsFrozen:false})observed.Changed+=Changed;
            // SDK 首帧才赋 Source；已有缓存 Source 的初始订阅不能算新帧。
            if(sender is not null)Changed(sender,args);
        }
        SourceChanged(null,EventArgs.Empty);descriptor.AddValueChanged(image,SourceChanged);
        // 合成缓冲区可原地更新而不替换 Source；短间隔重查现有图像，不必等整轮两秒超时再发现新帧。
        // 定时器只在有验帧谓词时启动，仍须通过相同样本检查，不能将时间流逝当作画面就绪。
        var retry=new DispatcherTimer(DispatcherPriority.Loaded,image.Dispatcher){Interval=TimeSpan.FromMilliseconds(32)};
        retry.Tick+=Changed;
        try{await invalidate();invalidated=true;if(acceptFrame is not null){Changed(null,EventArgs.Empty);retry.Start();}await frame.Task.WaitAsync(TimeSpan.FromSeconds(2),token);}
        finally{finished=true;retry.Stop();retry.Tick-=Changed;descriptor.RemoveValueChanged(image,SourceChanged);if(observed is {IsFrozen:false})observed.Changed-=Changed;}
    }
}
