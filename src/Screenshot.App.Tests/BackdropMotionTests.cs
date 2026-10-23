using Screenshot.App;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// 已有 STA 测试线程内只画内存位图；不创建 Window、不访问屏幕或系统输入。
internal static class BackdropMotionTests
{
    public static int Run()
    {
        var checks = 0;
        void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
        foreach (var rate in new[] { 30, 60, 144 })
        {
            var motion = new BackdropMotion(); motion.Enter(); motion.Move(1, 1);
            for (var i = 0; i < rate * 3; i++)
            {
                motion.Step(1d / rate); var frame = motion.Frame;
                Check(frame.X >= 0 && frame.X <= 9.001 && frame.Y >= 0 && frame.Y <= 9.001, "bounded background plus entry at " + rate);
            }
            Check(motion.Frame == new BackdropFrame(9, 6, 12, 8, 1) && !motion.Step(1d / rate), "background settles and sleeps at " + rate);
            motion.Move(-1, -1); motion.Step(.05); var previous = motion.Frame; var velocity = motion.VelocityX;
            motion.Move(1, 1); Check(motion.Frame == previous && motion.VelocityX == velocity && velocity < 0, "background reversal retains position and velocity");
            motion.Hold(); previous = motion.Frame; motion.Move(-1, -1);
            Check(!motion.Step(1) && motion.Frame == previous, "press freezes visible pose even after long frame");
            motion.Release(); for (var i = 0; i < rate * 3; i++) motion.Step(1d / rate);
            Check(motion.Frame.X == -9 && motion.Frame.Y == -6, "release targets last held pointer");
            motion.Center(); for (var i = 0; i < rate * 3; i++) motion.Step(1d / rate);
            Check(motion.Frame == new BackdropFrame(0, 0, 0, 0, 1), "reading and task center without changing content");
            motion.Move(100, -100); motion.Step(20);
            Check(double.IsFinite(motion.Frame.X) && Math.Abs(motion.Frame.X) <= 9 && Math.Abs(motion.Frame.Y) <= 6, "invalid range and long frame remain bounded");
            motion.Step(double.PositiveInfinity);
            Check(motion.Frame == new BackdropFrame(0, 0, 0, 0, 1), "hidden/reduced/handoff reset immediately");
            motion.Move(double.NaN, double.PositiveInfinity); motion.Step(.01);
            Check(motion.Frame.X == 0 && motion.Frame.Y == 0, "invalid pointer cannot poison springs");
            motion.Enter(); motion.Step(.03); motion.Hold(); previous = motion.Frame;
            Check(!motion.Step(.05) && motion.Frame == previous, "holding during entry does not snap visible background");
            motion.Release(); motion.Leave(); for (var i = 0; i < rate * 3; i++) motion.Step(1d / rate);
            Check(motion.Frame == new BackdropFrame(0, 0, 0, 0, 1), "lost capture / leave can finish interrupted entry");
        }
        var gate = new BackdropMotionGate(); gate.Reset("new");
        Check(!gate.Apply("old", 200, true) && !gate.Enabled, "old capture cannot enable new backdrop");
        Check(gate.Apply("new", 10, true) && gate.Enabled, "matching capture grants presentation-only motion");
        Check(gate.Apply("new", 12, false) && !gate.Enabled && !gate.Apply("new", 11, true) && !gate.Apply("new", 12, true), "late or duplicate permission cannot resume disabled backdrop");
        Check(!gate.Apply("new", -1, true) && !gate.Apply("new", long.MaxValue, true), "sequence stays in JS safe integer range");
        gate.Reset("new"); Check(!gate.Enabled && gate.Apply("new", 1, true), "page reload resets its permission and sequence");
        gate.Reset(null); Check(!gate.Apply("new", 15, true), "dismissal rejects late motion updates");
        var requests = new RequestGate(); requests.TryEnter("capture.adjust", out var lease);
        using (lease) Check(requests.TryEnter("presentation.background", out var decoration) && decoration is null, "motion suspension is not blocked by image crop encoding");

        var pixels = new byte[80 * 60 * 4];
        for (var i = 0; i < pixels.Length; i += 4) { pixels[i] = (byte)(i % 211); pixels[i + 1] = 140; pixels[i + 2] = 190; pixels[i + 3] = 255; }
        var source = BitmapSource.Create(80, 60, 96, 96, PixelFormats.Bgra32, null, pixels, 80 * 4); source.Freeze();
        var surface = new FrozenBackdropSurface { Source = source, Width = 80, Height = 60 };
        surface.Measure(new Size(80, 60)); surface.Arrange(new Rect(0, 0, 80, 60));
        byte[] Render(Visual visual)
        {
            if (visual is UIElement element) element.UpdateLayout();
            var target = new RenderTargetBitmap(80, 60, 96, 96, PixelFormats.Pbgra32); target.Render(visual);
            var result = new byte[pixels.Length]; target.CopyPixels(result, 80 * 4, 0); return result;
        }
        var neutral = Render(surface);
        Check(neutral.SequenceEqual(pixels), "handoff-neutral background preserves every source pixel: " + string.Join(',', neutral.Take(12)));
        // 真实外壳不设置背景的 Width/Height，并在隐藏时先赋图，不能只测显式尺寸。
        var automatic = new FrozenBackdropSurface { Visibility = Visibility.Collapsed };
        var shell = new Grid { Width = 80, Height = 60, Background = Brushes.Black };
        shell.Children.Add(automatic);
        shell.Measure(new Size(80, 60)); shell.Arrange(new Rect(0, 0, 80, 60)); Render(shell);
        automatic.Source = source; automatic.Visibility = Visibility.Visible;
        Check(Render(shell).SequenceEqual(pixels), "collapsed automatic backdrop paints on first reveal without black shell");
        automatic.Visibility = Visibility.Collapsed; Render(shell); automatic.Source = null;
        automatic.Source = source; automatic.Visibility = Visibility.Visible;
        Check(Render(shell).SequenceEqual(pixels), "same-sized repeated capture restores automatic backdrop");
        foreach (var pose in new[] { new BackdropFrame(6, 4, 12, 8, 1), new BackdropFrame(-6, -4, -12, -8, 1), new BackdropFrame(0, 3, 0, 0, 0) })
        {
            surface.ApplyFrame(pose); var actual = Render(surface);
            Check(Enumerable.Range(0, pixels.Length / 4).All(i => actual[i * 4 + 3] == 255), "edge strips cover translated stage without transparent seam");
        }
        var original = new byte[pixels.Length]; source.CopyPixels(original, 80 * 4, 0);
        Check(original.SequenceEqual(pixels) && ReferenceEquals(surface.Source, source), "motion never rewrites capture source");
        surface.ApplyFrame(new BackdropFrame(0, 0, 0, 0, 1)); var aligned = Render(surface);
        surface.ApplyFrame(new BackdropFrame(.5, 0, 0, 0, 1)); var halfPixel = Render(surface);
        surface.ApplyFrame(new BackdropFrame(1, 0, 0, 0, 1)); var wholePixel = Render(surface);
        var sample = (10 * 80 + 10) * 4;
        Check(halfPixel[sample] != aligned[sample] && halfPixel[sample] != wholePixel[sample], "subpixel motion interpolates instead of nearest-neighbor pixel steps");
        var container = new Grid { Width = 80, Height = 60 };
        container.Children.Add(surface);
        var editor = new Grid { RenderTransform = surface.MotionTransform };
        editor.Children.Add(new Border { Width = 30, Height = 20, Background = Brushes.White });
        container.Children.Add(editor);
        container.Measure(new Size(80, 60)); container.Arrange(new Rect(0, 0, 80, 60));
        Render(container); surface.ApplyFrame(new BackdropFrame(6, 4, 12, 8, 1));
        Check(container.IsMeasureValid && container.IsArrangeValid && surface.IsMeasureValid && surface.IsArrangeValid, "motion frame preserves layout validity instead of remeasuring full viewport");
        var after = Render(container);
        Check(editor.TransformToAncestor(container).Transform(new Point(25, 20)) == new Point(31, 24), "screenshot frame shares the exact native backdrop transform");
        Check(container.TranslatePoint(new Point(36, 29), editor) == new Point(30, 25), "WPF inverse hit mapping preserves original editor coordinates");
        Check(after[(24 * 80 + 31) * 4] == 255 && after[(20 * 80 + 25) * 4] != 255, "screenshot pixels move with their frame in the same composition");
        surface.Suspend(); Check(Render(surface).SequenceEqual(pixels), "suspend clears settled native transform");
        Check(editor.TransformToAncestor(container).Transform(new Point(25, 20)) == new Point(25, 20), "handoff/reset returns both layers to source alignment");
        surface.Source = null; Check(Render(surface).All(value => value == 0), "releasing source clears center and edge drawings");
        return checks;
    }
}
