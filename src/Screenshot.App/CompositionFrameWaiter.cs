using System;
using System.ComponentModel;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Media;

namespace Screenshot.App;

// 等待 WebView 模板图像的真实缓冲区更新；普通 WPF Rendering 或网页 RAF 不代表已收到浏览器画面。
internal static class CompositionFrameWaiter
{
    public static async Task WaitAsync(Image image,Func<Task> invalidate,CancellationToken token)
    {
        var frame=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var descriptor=DependencyPropertyDescriptor.FromProperty(Image.SourceProperty,typeof(Image));
        ImageSource? observed=null;
        void Changed(object? sender,EventArgs args)=>frame.TrySetResult();
        void SourceChanged(object? sender,EventArgs args)
        {
            if(observed is {IsFrozen:false})observed.Changed-=Changed;
            observed=image.Source;
            if(observed is {IsFrozen:false})observed.Changed+=Changed;
            // SDK 首帧才赋 Source；已有缓存 Source 的初始订阅不能算新帧。
            if(sender is not null&&observed is not null)frame.TrySetResult();
        }
        SourceChanged(null,EventArgs.Empty);descriptor.AddValueChanged(image,SourceChanged);
        try{await invalidate();await frame.Task.WaitAsync(TimeSpan.FromSeconds(2),token);}
        finally{descriptor.RemoveValueChanged(image,SourceChanged);if(observed is {IsFrozen:false})observed.Changed-=Changed;}
    }
}
