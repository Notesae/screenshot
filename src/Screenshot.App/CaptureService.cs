using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Windows.Media.Imaging;
using System.Threading;
using System.Threading.Tasks;

namespace Screenshot.App;
// 定义可替换的捕获后端，同时公开实际色彩能力供编辑器和验证记录使用。
public interface ICaptureBackend
{
    string Id { get; }
    bool SupportsHdr { get; }
    Task<CapturedFrame?> CaptureAsync(CaptureRequest request, CancellationToken token);
}

// GDI SDR 兼容基线；后续 WGC 实现可替换此后端，不宣称支持 HDR。
public sealed class GdiCaptureBackend : ICaptureBackend
{
    public string Id => "gdi";
    public bool SupportsHdr => false;
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    // 显式捕获后保持原生选区画面，PNG 编码在后台执行，完成握手后由宿主释放。
    public async Task<CapturedFrame?> CaptureAsync(CaptureRequest request, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if(request.Target.Kind!=CaptureTargetKind.Desktop)throw new CaptureException("capture_target_unsupported","GDI 兼容模式目前仅支持桌面与区域截图。");
        var bounds=new Rectangle(GetSystemMetrics(76),GetSystemMetrics(77),GetSystemMetrics(78),GetSystemMetrics(79));
        if(bounds.Width<=0||bounds.Height<=0||(long)bounds.Width*bounds.Height>100_000_000)throw new InvalidOperationException("桌面尺寸无效或过大。");
        var frozen=new Bitmap(bounds.Width,bounds.Height,PixelFormat.Format32bppArgb);
        RegionOverlay? overlay=null;var transferred=false;
        try
        {
            using(var graphics=Graphics.FromImage(frozen))graphics.CopyFromScreen(bounds.Location,Point.Empty,bounds.Size,CopyPixelOperation.SourceCopy);
            var desktop=new PixelRect(bounds.X,bounds.Y,bounds.Width,bounds.Height);
            CaptureDiagnostics.Current.Value?.Mark("pixels_acquired");
            var backdrop=ReadFrozenBitmap(frozen);var selected=desktop;
            if(request.Region)
            {
                overlay=new RegionOverlay(frozen,bounds,snapTargets:request.SnapWindows?WindowsWindowTargets.Snapshot():null,snapClient:request.SnapClientArea);
                var area=await overlay.SelectAsync(token);if(area is null)return null;selected=area.Value;
            }
            var image=await Task.Run(()=>NativeImages.FromBitmap(new CroppedBitmap(backdrop,new System.Windows.Int32Rect(selected.X-bounds.X,selected.Y-bounds.Y,selected.Width,selected.Height)),request.Region?"区域截图.png":"桌面截图.png"),token);
            if(overlay?.IsCancelled==true)return null;
            CaptureDiagnostics.Current.Value?.Mark("image_encoded");
            var screens=new System.Collections.Generic.List<CaptureScreen>();
            foreach(var screen in Screen.AllScreens)screens.Add(new(new(screen.Bounds.X,screen.Bounds.Y,screen.Bounds.Width,screen.Bounds.Height),screen.Primary));
            token.ThrowIfCancellationRequested();
            var frame=new CapturedFrame(image,backdrop,desktop,selected,screens){Backend=Id,Handoff=overlay};
            transferred=overlay is not null;return frame;
        }
        finally { if(!transferred){if(overlay is not null)overlay.Dispose();else frozen.Dispose();} }
    }
    // 冻结帧直接复制 BGRA 像素，移除之前只为转换格式而重复执行的 PNG 编解码。
    private static BitmapSource ReadFrozenBitmap(Bitmap bitmap)
    {
        var locked=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
        try
        {
            var stride=checked(bitmap.Width*4);var pixels=new byte[checked(stride*bitmap.Height)];
            for(var y=0;y<bitmap.Height;y++)Marshal.Copy(IntPtr.Add(locked.Scan0,y*locked.Stride),pixels,y*stride,stride);
            var source=BitmapSource.Create(bitmap.Width,bitmap.Height,96,96,System.Windows.Media.PixelFormats.Bgra32,null,pixels,stride);
            source.Freeze();return source;
        }
        finally{bitmap.UnlockBits(locked);}
    }
}

// 原生窗口只负责首次框选，松手后将冻结图交给原位编辑器。
internal sealed class RegionOverlay : Form, ICaptureHandoff
{
    private readonly Bitmap _frozen;
    private readonly CaptureDiagnostics? _trace=CaptureDiagnostics.Current.Value; // UI 事件保留对应捕获的计时上下文。
    private readonly Rectangle _desktop;
    private readonly RegionSelection _model;
    private Point _pointer;
    private bool _magnifier=true;
    private readonly System.Collections.Generic.IReadOnlyList<WindowSnapTarget> _snapTargets;
    private readonly PixelRect _allowed;
    private readonly bool _snapEnabled,_snapClient;
    private Point _down;
    private bool _startedEmpty;
    private WindowSnapTarget? HoverTarget=>_snapEnabled&&!_model.HasArea&&!_model.Dragging?CaptureTargets.AtPoint(_snapTargets,_pointer.X+_desktop.X,_pointer.Y+_desktop.Y,_allowed,_snapClient):null;
    // 选区结果与窗口存活分离，交接期间继续显示本次冻结帧，不阻塞消息循环。
    private readonly TaskCompletionSource<PixelRect?> _selected=new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _handingOff;
    // 仅活动装饰启动计时器；冻结背景与精确选区不随时间步进。
    private readonly CaptureMotion _feedback=new();
    private readonly System.Windows.Forms.Timer _motionTimer=new(){Interval=16};
    private long _motionLast;
    private Rectangle _hintBounds;
    public bool IsCancelled { get; private set; }
    [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)]private static extern nint SetOwner(nint window,int index,nint owner);
    // 先建立原生顶层窗口的 owner 关系，宿主 Show/置顶时也不能越过冻结遮挡。
    public void KeepAbove(nint owner)
    {
        if(IsDisposed||IsCancelled)return;
        Marshal.SetLastPInvokeError(0);
        if(SetOwner(Handle,-8,owner)==0&&Marshal.GetLastPInvokeError()!=0)throw new System.ComponentModel.Win32Exception(Marshal.GetLastPInvokeError());
        BringToFront();
    }
    public async Task<PixelRect?> SelectAsync(CancellationToken token)
    {
        Show();
        try{return await _selected.Task.WaitAsync(token);}catch{Close();throw;}
    }
    protected override void OnFormClosed(FormClosedEventArgs e){_motionTimer.Stop();IsCancelled=true;_selected.TrySetResult(null);base.OnFormClosed(e);}
    // 释放局部帧循环和系统偏好订阅，不影响交接窗口之外的桌面。
    protected override void Dispose(bool disposing)
    {
        if(disposing&&!IsDisposed)
        {
            System.Windows.SystemParameters.StaticPropertyChanged-=MotionPreferenceChanged;
            _motionTimer.Stop();_motionTimer.Dispose();_frozen.Dispose();
        }
        base.Dispose(disposing);
    }
    public RegionOverlay(Bitmap frozen,Rectangle desktop,PixelRect? allowedSelection=null,System.Collections.Generic.IReadOnlyList<WindowSnapTarget>? snapTargets=null,bool snapClient=false)
    {
        _frozen=frozen;_desktop=desktop;_allowed=allowedSelection ?? new(desktop.X,desktop.Y,desktop.Width,desktop.Height);_model=new(_allowed);_snapTargets=snapTargets??Array.Empty<WindowSnapTarget>();_snapEnabled=_snapTargets.Count>0;_snapClient=snapClient;
        AutoScaleMode=AutoScaleMode.None;FormBorderStyle=FormBorderStyle.None;StartPosition=FormStartPosition.Manual;Bounds=desktop;
        TopMost=true;ShowInTaskbar=false;DoubleBuffered=true;KeyPreview=true;Cursor=Cursors.Cross;Text="Screenshot 区域选择";
        _motionTimer.Tick+=AnimateFeedback;
        System.Windows.SystemParameters.StaticPropertyChanged+=MotionPreferenceChanged;
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e);Bounds=_desktop;Activate();_trace?.Mark("selection_visible");_trace?.Flush(); }
    // 按下空白从锚点起形，已有选区沿用精确的移动和缩放命中。
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if(e.Button==MouseButtons.Right){CancelSelection();return;}
        if(e.Button!=MouseButtons.Left||_handingOff)return;
        _down=e.Location;_startedEmpty=_model.HitTest(e.X+_desktop.X,e.Y+_desktop.Y)==SelectionHandle.Create;
        _model.Begin(e.X+_desktop.X,e.Y+_desktop.Y);_pointer=e.Location;
        // 按下空白立即显现软团；首次拉框独立保留原始锚点，选区模型仍即时更新。
        if(_startedEmpty){var scale=DeviceDpi/96d;_feedback.BeginFormation((e.X+_desktop.X)/scale,(e.Y+_desktop.Y)/scale,!System.Windows.SystemParameters.ClientAreaAnimation);}
        Capture=true;UpdateFeedback();Invalidate();
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);if(_handingOff)return;_pointer=e.Location;_model.Update(e.X+_desktop.X,e.Y+_desktop.Y);
        Cursor=_model.HitTest(e.X+_desktop.X,e.Y+_desktop.Y) switch {
            SelectionHandle.Move=>Cursors.SizeAll,
            SelectionHandle.Left or SelectionHandle.Right=>Cursors.SizeWE,
            SelectionHandle.Top or SelectionHandle.Bottom=>Cursors.SizeNS,
            SelectionHandle.TopLeft or SelectionHandle.BottomRight=>Cursors.SizeNWSE,
            SelectionHandle.TopRight or SelectionHandle.BottomLeft=>Cursors.SizeNESW,
            _=>Cursors.Cross };
        UpdateFeedback();Invalidate();
    }
    // 有效框选松手即交接；点击吸附也走同一入口，不保留确认步骤。
    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);if(e.Button!=MouseButtons.Left||!_model.Dragging)return;
        _pointer=e.Location;_model.Update(e.X+_desktop.X,e.Y+_desktop.Y);_model.End();
        if(_startedEmpty&&Math.Abs(e.X-_down.X)<=3&&Math.Abs(e.Y-_down.Y)<=3&&_snapEnabled){var target=CaptureTargets.AtPoint(_snapTargets,e.X+_desktop.X,e.Y+_desktop.Y,_allowed,_snapClient);if(target is not null){_feedback.Snap();_model.Set(target.Bounds);}}
        Capture=false;if(_model.HasArea)FinishSelection();else {UpdateFeedback();Invalidate();}
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if(e.KeyCode==Keys.Escape){CancelSelection();return;}
        if(e.KeyCode==Keys.M&&!_handingOff){_magnifier=!_magnifier;Invalidate();e.Handled=true;return;}
    }
    // 精确选区立即交付；软边只在原遮挡窗口存活期间回弹，不增加交接等待。
    private void FinishSelection()
    {
        if(!_model.HasArea||_model.Selection is not {} r)return;
        _trace?.Mark("selection_released");UpdateFeedback();_handingOff=true;_magnifier=false;
        Cursor=Cursors.Default;_selected.TrySetResult(r);Invalidate();
    }
    /// <summary>事件坐标先转 DIP，驱动软边、胶囊和控制点；选区模型保持物理像素。</summary>
    private void UpdateFeedback()
    {
        var displayed=_model.Selection??HoverTarget?.Bounds;var scale=DeviceDpi/96d;
        _feedback.Update((displayed?.X??0)/scale,(displayed?.Y??0)/scale,displayed is { Width:>0,Height:>0 },!System.Windows.SystemParameters.ClientAreaAnimation,(displayed?.Width??0)/scale,(displayed?.Height??0)/scale,_model.Dragging,(_pointer.X+_desktop.X)/scale,(_pointer.Y+_desktop.Y)/scale);
        if(!_feedback.Moving){_motionTimer.Stop();return;}
        if(_motionTimer.Enabled)return;
        _motionLast=System.Diagnostics.Stopwatch.GetTimestamp();_motionTimer.Start();
    }
    // 沿用原计时器推进软边与控制点；落定或窗口关闭后停止，不延迟精确选区交付。
    private void AnimateFeedback(object? sender,EventArgs args)
    {
        var now=System.Diagnostics.Stopwatch.GetTimestamp();
        var moving=_feedback.Step((now-_motionLast)/(double)System.Diagnostics.Stopwatch.Frequency);_motionLast=now;
        InvalidateFeedback();if(!moving)_motionTimer.Stop();
    }
    // 起点软团与选区周边使用局部重绘，既有计时器不为成形刷新整个冻结桌面。
    private void InvalidateFeedback()
    {
        var scale = DeviceDpi / 96f;
        if (!_hintBounds.IsEmpty) { var hint = _hintBounds; hint.Inflate((int)Math.Ceiling(12 * scale), (int)Math.Ceiling(12 * scale)); Invalidate(hint); }
        var creation = SoftClayMotion.SelectionTokens.GetProperty("creation");
        if (_feedback.SeedSize > 0)
        {
            var radius = (int)Math.Ceiling((creation.GetProperty("seed").GetDouble() + 4) * scale);
            Invalidate(new Rectangle(_down.X - radius, _down.Y - radius, radius * 2, radius * 2));
        }
        if ((_model.Selection ?? HoverTarget?.Bounds) is not {} r) return;
        var tokens = SoftClayMotion.SelectionTokens;
        var margin = (int)Math.Ceiling((Math.Max(tokens.GetProperty("maxLag").GetDouble(), creation.GetProperty("lag").GetDouble()) + tokens.GetProperty("radius").GetDouble() + tokens.GetProperty("bend").GetDouble() + tokens.GetProperty("ripple").GetDouble() + tokens.GetProperty("squash").GetDouble() + 8) * scale);
        var box = new Rectangle(r.X - _desktop.X, r.Y - _desktop.Y, r.Width, r.Height);
        box.Inflate(margin, margin);
        var horizontal = Math.Min(box.Height, margin * 2); var vertical = Math.Min(box.Width, margin * 2);
        Invalidate(new Rectangle(box.Left, box.Top, box.Width, horizontal));
        Invalidate(new Rectangle(box.Left, box.Bottom - horizontal, box.Width, horizontal));
        Invalidate(new Rectangle(box.Left, box.Top, vertical, box.Height));
        Invalidate(new Rectangle(box.Right - vertical, box.Top, vertical, box.Height));
    }
    // 系统偏好即刻优先，进行中的局部反馈归到无偏移的终态。
    private void MotionPreferenceChanged(object? sender,System.ComponentModel.PropertyChangedEventArgs args)
    {
        if(args.PropertyName!=nameof(System.Windows.SystemParameters.ClientAreaAnimation)||System.Windows.SystemParameters.ClientAreaAnimation||IsDisposed)return;
        if(InvokeRequired){if(IsHandleCreated)BeginInvoke((Action)(()=>MotionPreferenceChanged(sender,args)));return;}
        _motionTimer.Stop();_feedback.Snap();InvalidateFeedback();
    }
    private void CancelSelection() { IsCancelled=true;_selected.TrySetResult(null);Close(); }
    // 边框、镂空和控制点共用弹性轮廓；冻结图只裁切显示，精确截图矩形不参与变形。
    protected override void OnPaint(PaintEventArgs e)
    {
        var g=e.Graphics;g.DrawImageUnscaled(_frozen,0,0);
        using var shade=new SolidBrush(SoftClayDrawing.Color("mask"));g.FillRectangle(shade,ClientRectangle);
        var displayed=_model.Selection??HoverTarget?.Bounds;
        if(displayed is {} r && r.Width>0 && r.Height>0)
        {
            var box=new Rectangle(r.X-_desktop.X,r.Y-_desktop.Y,r.Width,r.Height);
            g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var scale=DeviceDpi/96f;
            var handles=DrawSelectionBorder(g,box,scale);
            using var pen=new Pen(SoftClayDrawing.Color("accent"),(float)SoftClayTheme.Number("size","selectionBorder")*scale);
            for(var index=0;index<handles.Length;index++)
            {
                var reveal=_feedback.HandleReveal(index);if(reveal<=.01)continue;
                var point=handles[index];var diameter=(float)(SoftClayTheme.Number("size","handle")*reveal)*scale;
                var handle=new RectangleF(point.X-diameter/2,point.Y-diameter/2,diameter,diameter);
                using var fill=new System.Drawing.Drawing2D.LinearGradientBrush(handle,Color.White,Color.FromArgb(215,222,233),90);
                g.FillEllipse(fill,handle);g.DrawEllipse(pen,handle);
            }
            // 松手前后尺寸胶囊保持相同内容，避免交接时突然缩短。
            _hintBounds=DrawHint(g,$"{r.Width} × {r.Height} px",box.X,box.Y-38,true);
        }
        else
        {
            var size=(float)_feedback.SeedSize*DeviceDpi/96;
            if(size>0)
            {
                g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                DrawSelectionBorder(g,new RectangleF(_down.X-size/2,_down.Y-size/2,size,size),DeviceDpi/96f);
            }
            _hintBounds=DrawHint(g,"拖动框选 · M 放大镜 · Esc / 右键取消",Math.Max(12,-_desktop.X+24),Math.Max(12,-_desktop.Y+24));
        }
        if(_magnifier)DrawMagnifier(g);
        if(!_handingOff)
        {
            using var cross=new Pen(SoftClayDrawing.Color("focus"),1);
            g.DrawLine(cross,_pointer.X-8,_pointer.Y,_pointer.X+8,_pointer.Y);g.DrawLine(cross,_pointer.X,_pointer.Y-8,_pointer.X,_pointer.Y+8);
        }
    }
    /// <summary>把四个受力顶点连成同一条软边，镂空和控制点都由本帧的三次曲线取样。</summary>
    private PointF[] DrawSelectionBorder(Graphics graphics, RectangleF box, float scale)
    {
        var shape = _feedback.Border;
        var l = box.Left + (float)shape.Left * scale; var t = box.Top + (float)shape.Top * scale;
        var r = box.Right + (float)shape.Right * scale; var b = box.Bottom + (float)shape.Bottom * scale;
        Vector2[] vertices = [new(l, t), new(r, t), new(r, b), new(l, b)];
        var directions = new Vector2[4]; var lengths = new float[4];
        for (var index = 0; index < 4; index++)
            vertices[index] += new Vector2((float)shape.OffsetX[index] * scale, (float)shape.OffsetY[index] * scale);
        for (var index = 0; index < 4; index++)
        {
            var edge = vertices[(index + 1) % 4] - vertices[index];
            lengths[index] = edge.Length(); directions[index] = lengths[index] > 0 ? edge / lengths[index] : Vector2.Zero;
        }
        // 圆角最多占相邻边的一半，小框和按下软团都不会产生相互穿过的圆角。
        var incoming = new Vector2[4]; var outgoing = new Vector2[4];
        for (var index = 0; index < 4; index++)
        {
            var radius = Math.Min((float)shape.Corners[index] * scale, Math.Min(lengths[(index + 3) % 4], lengths[index]) / 2);
            incoming[index] = vertices[index] - directions[(index + 3) % 4] * radius;
            outgoing[index] = vertices[index] + directions[index] * radius;
        }
        float[] bends = [(float)shape.BendTop * scale, (float)shape.BendRight * scale, (float)shape.BendBottom * scale, (float)shape.BendLeft * scale];
        float[] waves = [(float)shape.RippleX * scale, (float)shape.RippleY * scale, -(float)shape.RippleX * scale, -(float)shape.RippleY * scale];
        var handles = new PointF[8];
        using var path = new System.Drawing.Drawing2D.GraphicsPath();
        for (var index = 0; index < 4; index++)
        {
            var next = (index + 1) % 4; var start = outgoing[index]; var end = incoming[next];
            var normal = index % 2 == 0 ? new Vector2(0, 1) : new Vector2(1, 0);
            var c1 = Vector2.Lerp(start, end, 1f / 3) + normal * (bends[index] - waves[index]);
            var c2 = Vector2.Lerp(start, end, 2f / 3) + normal * (bends[index] + waves[index]);
            path.AddBezier(start.X, start.Y, c1.X, c1.Y, c2.X, c2.Y, end.X, end.Y);
            var midpoint = (start + end) * .125f + (c1 + c2) * .375f;
            handles[index * 2 + 1] = new(midpoint.X, midpoint.Y);
            // 相邻角的切线随顶点方向旋转，牵开时也保持软角连续。
            c1 = Vector2.Lerp(vertices[next], end, .45f); c2 = Vector2.Lerp(vertices[next], outgoing[next], .45f);
            start = end; end = outgoing[next];
            path.AddBezier(start.X, start.Y, c1.X, c1.Y, c2.X, c2.Y, end.X, end.Y);
            midpoint = (start + end) * .125f + (c1 + c2) * .375f;
            handles[next * 2] = new(midpoint.X, midpoint.Y);
        }
        path.CloseFigure();
        var state = graphics.Save();
        graphics.SetClip(path, System.Drawing.Drawing2D.CombineMode.Intersect);
        graphics.DrawImageUnscaled(_frozen, 0, 0);
        graphics.Restore(state);
        using var edgePen = new Pen(SoftClayDrawing.Color("accent"), (float)SoftClayTheme.Number("size", "selectionBorder") * scale);
        graphics.DrawPath(edgePen, path);
        return handles;
    }
    // 放大镜只读取本次冻结图，最近邻放大显示真实像素；不访问系统指针或再次捕获。
    private void DrawMagnifier(Graphics g)
    {
        var source=new Rectangle(Math.Clamp(_pointer.X-7,0,Math.Max(0,_frozen.Width-15)),Math.Clamp(_pointer.Y-7,0,Math.Max(0,_frozen.Height-15)),Math.Min(15,_frozen.Width),Math.Min(15,_frozen.Height));
        var target=new Rectangle(Math.Clamp(_pointer.X+28,0,Math.Max(0,ClientSize.Width-128)),Math.Clamp(_pointer.Y+28,0,Math.Max(0,ClientSize.Height-156)),120,120);
        var state=g.Save();g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;g.PixelOffsetMode=System.Drawing.Drawing2D.PixelOffsetMode.Half;
        using var clip=SoftClayDrawing.Rounded(target,(float)SoftClayTheme.Number("radius","floating"));g.SetClip(clip);g.DrawImage(_frozen,target,source,GraphicsUnit.Pixel);g.Restore(state);
        g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;using var border=new Pen(SoftClayDrawing.Color("accent"),1.25f);g.DrawPath(border,clip);
        var px=Math.Clamp(_pointer.X,0,_frozen.Width-1);var py=Math.Clamp(_pointer.Y,0,_frozen.Height-1);
        var centerX=target.X+(px-source.X)*target.Width/source.Width;var centerY=target.Y+(py-source.Y)*target.Height/source.Height;
        g.DrawRectangle(border,centerX,centerY,Math.Max(1,target.Width/source.Width),Math.Max(1,target.Height/source.Height));
        var color=_frozen.GetPixel(px,py);DrawHint(g,$"{px+_desktop.X}, {py+_desktop.Y} · #{color.R:X2}{color.G:X2}{color.B:X2} · M 隐藏",target.X,target.Bottom+3);
    }
    // 尺寸和指针读数使用同一凸面胶囊；文字随窗口 DPI 缩放，截图像素保持原样。
    private Rectangle DrawHint(Graphics graphics,string text,int x,int y,bool animated=false)
    {
        // WPF/CSS 字号以 DIP 记录，GDI 的点数换算后继续随窗口 DPI 缩放。
        using var font=new Font(SoftClayTheme.Font.Source.Split(',')[0].Trim(),(float)SoftClayTheme.Number("type","body")*72/96,GraphicsUnit.Point);var size=graphics.MeasureString(text,font);
        if(animated){x+=(int)Math.Round(_feedback.OffsetX*DeviceDpi/96);y+=(int)Math.Round(_feedback.OffsetY*DeviceDpi/96);}
        x=Math.Clamp(x,0,Math.Max(0,ClientSize.Width-(int)size.Width-16));y=Math.Clamp(y,0,Math.Max(0,ClientSize.Height-(int)size.Height-12));
        graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        SoftClayDrawing.Surface(graphics,new RectangleF(x,y,size.Width+16,size.Height+12),(float)SoftClayTheme.Number("radius","pill"));
        using var ink=new SolidBrush(SoftClayDrawing.Color("ink"));graphics.DrawString(text,font,ink,x+8,y+6);
        return Rectangle.Ceiling(new RectangleF(x,y,size.Width+16,size.Height+12));
    }
}
