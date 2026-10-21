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
        // 在 SDK 的 Unlock/Source setter 返回之后读样本，合并同一帧通知，避免重入图形缓冲区。
        void Changed(object? sender,EventArgs args)
        {
            if(queued||finished)return;queued=true;
            image.Dispatcher.BeginInvoke(DispatcherPriority.Background,new Action(()=>{
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
        try{await invalidate();invalidated=true;if(acceptFrame is not null)Changed(null,EventArgs.Empty);await frame.Task.WaitAsync(TimeSpan.FromSeconds(2),token);}
        finally{finished=true;descriptor.RemoveValueChanged(image,SourceChanged);if(observed is {IsFrozen:false})observed.Changed-=Changed;}
    }
}
