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
    // 普通源变化保留兼容行为；截图调用通过谓词拒绝透明帧、错误内容和作废的异步通知。
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

        // 与旧缺陷完全相同的 Changed 事件：透明像素及无关内容都不能通过截图谓词。
        var pendingDrawing=new DrawingGroup();var pendingImage=new Image{Source=new DrawingImage(pendingDrawing)};
        wait=CompositionFrameWaiter.WaitAsync(pendingImage,()=>{pendingDrawing.Children.Add(new GeometryDrawing(Brushes.Transparent,null,new RectangleGeometry(new(0,0,2,2))));return Task.CompletedTask;},CancellationToken.None,IsPreparedFrame);
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(!wait.IsCompleted,"透明空帧不能完成截图合成等待");
        pendingDrawing.Children.Add(new GeometryDrawing(Brushes.Red,null,new RectangleGeometry(new(0,0,2,2))));
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(!wait.IsCompleted,"无关的非透明帧也不能代替当前截图");
        pendingDrawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));
        await wait;Check(wait.IsCompletedSuccessfully,"正确内容的后续 Changed 才完成等待");

        // 已经准备好的正确帧不再等待下一次事件，但显示回调仍必须执行。
        var invalidations=0;
        wait=CompositionFrameWaiter.WaitAsync(pendingImage,()=>{invalidations++;return Task.CompletedTask;},CancellationToken.None,IsPreparedFrame);
        await wait;
        Check(wait.IsCompletedSuccessfully,"已准备的正确帧立即完成，不额外等待下一事件");
        Check(invalidations==1,"已有正确帧仍执行一次显示回调");

        // 揭示回调尚未完成时到来的蓝帧不能锁定成功；回调结束必须重新检查当时的透明帧。
        var revealDrawing=new DrawingGroup();var revealImage=new Image{Source=new DrawingImage(revealDrawing)};
        var revealGate=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var rejectedAfterReveal=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var revealFinished=false;
        wait=CompositionFrameWaiter.WaitAsync(revealImage,async()=>{await revealGate.Task;revealFinished=true;},CancellationToken.None,frame=>{
            var prepared=IsPreparedFrame(frame);if(revealFinished&&!prepared)rejectedAfterReveal.TrySetResult();return prepared;
        });
        revealDrawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(!wait.IsCompleted,"显示回调挂起期间的早到帧不能结束等待");
        revealDrawing.Children.Clear();revealDrawing.Children.Add(new GeometryDrawing(Brushes.Transparent,null,new RectangleGeometry(new(0,0,2,2))));
        await Dispatcher.Yield(DispatcherPriority.Background);
        revealGate.SetResult();
        // 等到回调完成后的实际谓词检查，避免用 async Task 完成传播的时机推测是否正确验帧。
        await rejectedAfterReveal.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Check(!wait.IsCompleted,"显示回调完成后仍透明时不能复用早到蓝帧");
        revealDrawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));
        await wait;Check(wait.IsCompletedSuccessfully,"回调完成后的正确帧才完成交接");

        var assignedDrawing=new DrawingGroup();var assignedImage=new Image();
        wait=CompositionFrameWaiter.WaitAsync(assignedImage,()=>{assignedImage.Source=new DrawingImage(assignedDrawing);return Task.CompletedTask;},CancellationToken.None,IsPreparedFrame);
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(!wait.IsCompleted,"首次赋给模板的空 Source 不算正确帧");
        assignedDrawing.Children.Add(new GeometryDrawing(Brushes.Transparent,null,new RectangleGeometry(new(0,0,2,2))));
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(!wait.IsCompleted,"首次空 Source 的透明 Changed 仍应拒绝");
        assignedImage.Source=pendingImage.Source;
        await wait;Check(wait.IsCompletedSuccessfully,"替换为已经准备好的 Source 可以完成等待");
        pendingImage.Source.Freeze();
        wait=CompositionFrameWaiter.WaitAsync(pendingImage,()=>Task.CompletedTask,CancellationToken.None,IsPreparedFrame);
        await wait;Check(wait.IsCompletedSuccessfully,"冻结的正确帧无需 Changed 事件也可完成等待");

        // 统计谓词调用可直接发现残留订阅，避免只检查 Task 状态而漏掉取消后的事件泄露。
        var cancelledDrawing=new DrawingGroup();var cancelledImage=new Image{Source=new DrawingImage(cancelledDrawing)};var cancelledCalls=0;
        using var predicateCancel=new CancellationTokenSource();
        wait=CompositionFrameWaiter.WaitAsync(cancelledImage,()=>Task.CompletedTask,predicateCancel.Token,frame=>{cancelledCalls++;return IsPreparedFrame(frame);});
        Check(!wait.IsCompleted,"不合格帧保持可取消的等待");
        cancelledDrawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));
        Check(!wait.IsCompleted,"源变化排队后不能在事件内部重入验帧");predicateCancel.Cancel();
        try{await wait;throw new Exception("谓词等待也必须响应取消");}catch(OperationCanceledException){count++;}
        var callsAfterCancel=cancelledCalls;
        cancelledDrawing.Children.Add(new GeometryDrawing(Brushes.Transparent,null,new RectangleGeometry(new(0,0,2,2))));cancelledImage.Source=pendingImage.Source;
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(cancelledCalls==callsAfterCancel,"取消后移除 Source 与 Changed 订阅，不再调用谓词");
        Check(wait.IsCanceled,"取消任务不接受迟到的正确帧");
        wait=CompositionFrameWaiter.WaitAsync(cancelledImage,()=>Task.CompletedTask,CancellationToken.None,IsPreparedFrame);
        await wait;Check(wait.IsCompletedSuccessfully,"取消清理后可以对正确缓存帧重新等待");

        var failedDrawing=new DrawingGroup();var failedImage=new Image{Source=new DrawingImage(failedDrawing)};var failedCalls=0;
        wait=CompositionFrameWaiter.WaitAsync(failedImage,()=>throw new InvalidOperationException("synthetic invalidation"),CancellationToken.None,frame=>{failedCalls++;return IsPreparedFrame(frame);});
        try{await wait;throw new Exception("显示回调异常不能报告成功");}catch(InvalidOperationException){count++;}
        var callsAfterFailure=failedCalls;
        failedDrawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));failedImage.Source=pendingImage.Source;
        await Dispatcher.Yield(DispatcherPriority.Background);
        Check(failedCalls==callsAfterFailure,"显示失败后清理所有帧订阅");
        Check(wait.IsFaulted,"显示失败不接受迟到的正确帧");
        wait=CompositionFrameWaiter.WaitAsync(failedImage,()=>Task.CompletedTask,CancellationToken.None,IsPreparedFrame);
        await wait;Check(wait.IsCompletedSuccessfully,"异常清理后仍能对正确帧重试");

        // 谓词可能在读取 SDK 缓冲区时失败：错误应进入 Task，不能逃到 Dispatcher 的未处理异常管道。
        var throwingDrawing=new DrawingGroup();var throwingImage=new Image{Source=new DrawingImage(throwingDrawing)};var throwingCalls=0;
        Exception? dispatcherFailure=null;
        DispatcherUnhandledExceptionEventHandler trap=(_,args)=>{dispatcherFailure=args.Exception;args.Handled=true;};
        Dispatcher.CurrentDispatcher.UnhandledException+=trap;
        try
        {
            wait=CompositionFrameWaiter.WaitAsync(throwingImage,()=>Task.CompletedTask,CancellationToken.None,frame=>{
                throwingCalls++;if(IsPreparedFrame(frame))throw new InvalidOperationException("synthetic predicate");return false;
            });
            throwingDrawing.Children.Add(new GeometryDrawing(Brushes.Blue,null,new RectangleGeometry(new(0,0,2,2))));
            try{await wait;throw new Exception("验帧谓词异常不能报告成功");}catch(InvalidOperationException error)when(error.Message=="synthetic predicate"){count++;}
            Check(dispatcherFailure is null,"谓词异常必须由等待任务观察，不能成为 Dispatcher 未处理错误");
            var callsAfterPredicateFailure=throwingCalls;
            throwingDrawing.Children.Add(new GeometryDrawing(Brushes.Transparent,null,new RectangleGeometry(new(0,0,2,2))));throwingImage.Source=pendingImage.Source;
            await Dispatcher.Yield(DispatcherPriority.Background);
            Check(throwingCalls==callsAfterPredicateFailure,"谓词失败后也必须清理订阅与已排队检查");
            Check(wait.IsFaulted,"谓词错误任务不接受迟到的正确帧");
        }
        finally{Dispatcher.CurrentDispatcher.UnhandledException-=trap;}
        return count;
    }

    // 蓝色几何只充当当前截图已准备好的测试标记；透明/红色帧模拟清屏与其它画面。
    private static bool IsPreparedFrame(ImageSource frame)=>frame is DrawingImage{Drawing:DrawingGroup group}
        &&group.Children.OfType<GeometryDrawing>().Any(drawing=>drawing.Brush is SolidColorBrush brush&&brush.Color==Colors.Blue&&!drawing.Bounds.IsEmpty);
}
