using Screenshot.App;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

// 使用离屏 DrawingImage 模拟 SDK 缓冲区更新，不创建窗口或访问屏幕/GPU 捕获。
internal static class CompositionFrameTests
{
    public static int Run()
    {
        Exception? failure=null;var count=0;
        // 仅泵送测试对象自己的 Dispatcher，确保异步清理发生在所属 STA；没有 Window 或输入。
        var thread=new Thread(()=>{
            var dispatcher=Dispatcher.CurrentDispatcher;
            dispatcher.InvokeAsync(async()=>{try{count=await VerifyAsync();}catch(Exception error){failure=error;}finally{dispatcher.BeginInvokeShutdown(DispatcherPriority.Background);}});
            Dispatcher.Run();
        });
        thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();
        if(failure is not null)throw new Exception("合成帧等待回归失败",failure);return count;
    }
    private static async Task<int> VerifyAsync()
    {
        var count=0;
        void Check(bool ok,string name){if(!ok)throw new Exception(name);count++;}
        var drawing=new DrawingGroup();var source=new DrawingImage(drawing);var image=new Image{Source=source};
        var wait=CompositionFrameWaiter.WaitAsync(image,()=>Task.CompletedTask,CancellationToken.None);
        Check(!wait.IsCompleted,"缓存图像与普通布局不能当作新合成帧");
        drawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));
        await wait;Check(wait.IsCompletedSuccessfully,"真实源图变化才接受合成帧");
        image.Source=null;
        wait=CompositionFrameWaiter.WaitAsync(image,()=>{image.Source=source;return Task.CompletedTask;},CancellationToken.None);
        await wait;Check(wait.IsCompletedSuccessfully,"首次 SDK 赋图也完成帧等待");
        using var cancel=new CancellationTokenSource();
        wait=CompositionFrameWaiter.WaitAsync(image,()=>Task.CompletedTask,cancel.Token);cancel.Cancel();
        try{await wait;throw new Exception("取消必须结束等待");}catch(OperationCanceledException){count++;}
        wait=CompositionFrameWaiter.WaitAsync(image,()=>throw new InvalidOperationException("synthetic"),CancellationToken.None);
        try{await wait;throw new Exception("无效显示回调必须失败");}catch(InvalidOperationException){count++;}
        // 清理后的旧源变化不应令取消或失败任务成功，也不阻止后续等待。
        drawing.Children.Clear();Check(wait.IsFaulted,"失败任务不接受迟到源帧");
        wait=CompositionFrameWaiter.WaitAsync(image,()=>{drawing.Children.Add(new GeometryDrawing());return Task.CompletedTask;},CancellationToken.None);
        await wait;Check(wait.IsCompletedSuccessfully,"取消及异常后订阅清理且可重试");
        return count;
    }
}
