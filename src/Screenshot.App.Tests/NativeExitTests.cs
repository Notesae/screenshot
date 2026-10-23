using Screenshot.App;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

// 只推进纯状态和内存模板，不创建/显示 Window 或打开 Popup，不注入系统输入。
internal static class NativeExitTests
{
    public static int Run(ResourceDictionary resources)
    {
        var checks = 0;
        checks += NativeNoticeSequenceTests.Run();
        void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }
        foreach (var rate in new[] { 30, 60, 144 })
        foreach (var duration in new[] { NativeSurfaceTransition.WindowExitSeconds, NativeSurfaceTransition.PopupExitSeconds })
        {
            var transition = new NativeSurfaceTransition(); transition.Open(); transition.Step(1d / rate);
            var early = transition.Frame;
            Check(early.Material > 0 && early.Content < early.Material, "native material precedes content " + rate);
            transition.Close(duration, 0, -1);
            Check(transition.Frame == early, "early close continues exact visible frame " + rate);
            var prior = early;
            for (var frame = 0; frame < rate; frame++)
            {
                transition.Step(1d / rate); var current = transition.Frame;
                Check(current.Material <= prior.Material && current.Content <= prior.Content, "exit never flashes brighter " + rate);
                Check(Math.Abs(current.Y - early.Y) <= 6.001 && current.ScaleX >= early.ScaleX * .98 - .001
                    && current.ScaleY >= early.ScaleY * .97 - .001, "native exit retracts only a short distance " + rate);
                prior = current;
            }
            Check(!transition.Moving && transition.Frame.Material == 0 && transition.Frame.Content == 0, "native exit finishes and sleeps " + rate);
            var closed = transition.Frame; transition.Step(1); Check(transition.Frame == closed, "idle does not alter closed surface " + rate);
            transition.Open(); Check(transition.Frame == closed, "reopen starts at current closed frame " + rate);
            for (var frame = 0; frame < rate * 2; frame++) transition.Step(1d / rate);
            Check(!transition.Moving && transition.Frame == NativeSurfaceFrame.Open, "reopen settles readable surface " + rate);
        }
        var reverse = new NativeSurfaceTransition(); reverse.Open(); reverse.Step(double.PositiveInfinity);
        reverse.Close(.17); reverse.Step(.05); var partial = reverse.Frame;
        reverse.Open(); Check(reverse.Frame == partial, "quick reopen preserves partial exit alpha and geometry");
        reverse.Step(.016); Check(reverse.Frame.Material >= partial.Material && reverse.Frame.Content >= partial.Content, "quick reopen returns toward visible without a fade reset");
        reverse.Close(.17); reverse.Step(.02); var velocity = reverse.Velocity; partial = reverse.Frame;
        reverse.Open(); Check(reverse.Frame == partial && reverse.Velocity == velocity, "native reopen preserves geometry velocity as well as position");
        reverse.Close(.17); reverse.Step(double.PositiveInfinity);
        Check(reverse.Frame.Material == 0 && reverse.Frame.Content == 0 && !reverse.Moving, "reduced motion completes close instead of reopening");
        reverse.Open(); reverse.Step(double.PositiveInfinity);
        Check(reverse.Frame == NativeSurfaceFrame.Open && !reverse.Moving, "reduced motion completes entrance");
        reverse.Close(.17); reverse.Step(.05); reverse.Close(.17); reverse.Step(.05); reverse.Step(.05); reverse.Step(.02);
        Check(!reverse.Moving && reverse.Frame.Material == 0, "repeated close does not restart its deadline");
        foreach (var result in new bool?[] { null, false, true })
        {
            var gate = new NativeCloseGate();
            Check(gate.Request(false, true, result) == NativeCloseDecision.StartExit, "modal close starts presentation hold");
            var version = gate.Version;
            Check(gate.Request(false, true, null) == NativeCloseDecision.Hold && gate.Version == version && gate.DialogResult == result, "duplicate close preserves first explicit dialog result");
            Check(gate.TryCommit(version) && !gate.TryCommit(version), "close continuation can commit only once");
            Check(gate.Request(false, true, null) == NativeCloseDecision.Immediate && gate.DialogResult == result, "commit retains true/false/null independently of animation");
            Check(gate.Request(true, true, result) == NativeCloseDecision.Cancelled && !gate.Pending && !gate.Committing, "late native close protection still cancels");
            Check(!gate.TryCommit(version), "late callback after cancellation cannot close window");
            Check(gate.Request(false, true, result) == NativeCloseDecision.StartExit, "cancelled window can request close again");
            var resumed = gate.Version; gate.Cancel(); Check(!gate.TryCommit(resumed), "explicit reopen invalidates old close");
            Check(gate.Request(false, false, result) == NativeCloseDecision.Immediate && !gate.Pending, "hidden/reduced window closes directly");
        }
        var queue = new DeferredNativeAction(); var actions = 0;
        queue.Set(() => actions++); Check(actions == 0, "tray command does not run while retained menu is visible");
        var afterClosed = queue.Take()!; Check(queue.Take() is null && actions == 0, "Closed transfers rather than duplicates command");
        afterClosed(); afterClosed(); Check(actions == 1, "deferred command executes exactly once");
        queue.Set(() => actions++); var stale = queue.Take()!; queue.Cancel(); stale();
        Check(actions == 1, "reopen before dispatcher callback invalidates stale tray command");
        queue.Set(() => actions++); stale = queue.Take()!; queue.Set(() => actions += 10); stale(); queue.Take()!();
        Check(actions == 11, "newer tray intent replaces older queued action");
        foreach (var placement in new[] { PlacementMode.Top, PlacementMode.Bottom, PlacementMode.Left, PlacementMode.Right, PlacementMode.MousePoint })
        {
            var (x, y) = SoftClayPopupMotion.Direction(placement);
            Check(Math.Abs(x) + Math.Abs(y) == 1, "popup direction has one bounded retraction axis");
        }
        foreach (var host in new Control[] { new ContextMenu(), new ToolTip(), new ComboBox() })
        {
            host.Resources.MergedDictionaries.Add(resources); host.Style = (Style)resources[host.GetType()]; host.ApplyTemplate();
            if (host is ComboBox combo)
            {
                var popup = (Popup)combo.Template.FindName("PART_Popup", combo); var content = (SoftClayPopupSurface)popup.Child;
                using var adapter = SoftClayPopupMotion.Attach(content);
                Check(adapter is not null && !popup.IsOpen && PresentationSource.FromVisual(content) is null, "combo adapter attaches to an unshown template popup");
            }
            else
            {
                // 菜单/提示的私有宿主只能由 WPF 打开流程建立；测试不伪造父级或打开它。
                var content = (SoftClayPopupSurface)VisualTreeHelper.GetChild(host, 0);
                using var adapter = SoftClayPopupMotion.Attach(content);
                Check(adapter is null && PresentationSource.FromVisual(content) is null, "unshown menu/tooltip template does not manufacture a native popup: " + host.GetType().Name);
            }
        }
        var directPopup = new Popup { Child = new SoftClayPopupSurface(), AllowsTransparency = true };
        using (var adapter = SoftClayPopupMotion.Attach((SoftClayPopupSurface)directPopup.Child))
            Check(adapter is not null && !directPopup.IsOpen, "public logical popup parent can be observed without HWND");
        Check(SoftClayPopupMotion.Direction(PlacementMode.MousePoint).Y < 0 && SoftClayPopupMotion.Direction(PlacementMode.Bottom).Y < 0
            && SoftClayPopupMotion.Direction(PlacementMode.Top).Y > 0, "popup retracts toward the requested source side");
        var surface = new SoftClayPopupSurface { Style = (Style)resources[typeof(SoftClayPopupSurface)], Content = new Button { Content = "合成按钮" } };
        surface.ApplyTemplate(); surface.Measure(new Size(320, 120)); surface.Arrange(new Rect(0, 0, 320, 120));
        surface.SetClosing(true);
        Check(surface.IsClosing && !surface.IsEnabled && !surface.IsHitTestVisible && !((Button)surface.Content).IsEnabled,
            $"retained native surface immediately stops pointer and keyboard input: closing={surface.IsClosing}, enabled={surface.IsEnabled}, hit={surface.IsHitTestVisible}, childEnabled={((Button)surface.Content).IsEnabled}");
        surface.SetClosing(false); Check(surface.IsEnabled && surface.IsHitTestVisible, "reopen restores semantic input");
        surface.IsEnabled = false; surface.SetClosing(true); surface.SetClosing(false);
        Check(!surface.IsEnabled, "reopen preserves an externally disabled control");
        var face = (FrameworkElement)surface.Template.FindName("Face", surface);
        var body = (FrameworkElement)surface.Template.FindName("Glyph", surface);
        SoftClayMotion.EnterSurface(surface, face, body); var completed = 0;
        SoftClayMotion.ExitSurface(surface, .17, 0, 1, () => completed++);
        Check(completed == 1 && face.Opacity == 0 && body.Opacity == 0 && surface.RenderTransform.Value.IsIdentity
            && body.RenderTransform is TranslateTransform, "unshown exit resolves without HWND or scaled text");
        SoftClayMotion.StopTimeline(surface); Check(completed == 1, "synchronous completion cannot run twice");
        SoftClayMotion.EnterSurface(surface, face, body);
        Check(face.Opacity == 1 && body.Opacity == 1, "unshown reopen resolves to a readable final state");
        SoftClayMotion.StopSurface(surface);
        Check(face.RenderTransform.Value.IsIdentity && body.Opacity == 1, "unload removes retained state and restores template parts");
        return checks;
    }
}
