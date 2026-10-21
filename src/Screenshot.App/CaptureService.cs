using System;
using System.Drawing;
using System.Drawing.Imaging;
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
    protected override void OnFormClosed(FormClosedEventArgs e){IsCancelled=true;_selected.TrySetResult(null);base.OnFormClosed(e);}
    protected override void Dispose(bool disposing){if(disposing&&!IsDisposed)_frozen.Dispose();base.Dispose(disposing);}
    public RegionOverlay(Bitmap frozen,Rectangle desktop,PixelRect? allowedSelection=null,System.Collections.Generic.IReadOnlyList<WindowSnapTarget>? snapTargets=null,bool snapClient=false)
    {
        _frozen=frozen;_desktop=desktop;_allowed=allowedSelection ?? new(desktop.X,desktop.Y,desktop.Width,desktop.Height);_model=new(_allowed);_snapTargets=snapTargets??Array.Empty<WindowSnapTarget>();_snapEnabled=_snapTargets.Count>0;_snapClient=snapClient;
        AutoScaleMode=AutoScaleMode.None;FormBorderStyle=FormBorderStyle.None;StartPosition=FormStartPosition.Manual;Bounds=desktop;
        TopMost=true;ShowInTaskbar=false;DoubleBuffered=true;KeyPreview=true;Cursor=Cursors.Cross;Text="Screenshot 区域选择";
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e);Bounds=_desktop;Activate();_trace?.Mark("selection_visible");_trace?.Flush(); }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if(e.Button==MouseButtons.Right){CancelSelection();return;}
        if(e.Button!=MouseButtons.Left||_handingOff)return;
        _down=e.Location;_startedEmpty=_model.HitTest(e.X+_desktop.X,e.Y+_desktop.Y)==SelectionHandle.Create;
        _model.Begin(e.X+_desktop.X,e.Y+_desktop.Y);_pointer=e.Location;Capture=true;Invalidate();
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
        Invalidate();
    }
    // 有效框选松手即交接；点击吸附也走同一入口，不保留确认步骤。
    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);if(e.Button!=MouseButtons.Left||!_model.Dragging)return;
        _model.Update(e.X+_desktop.X,e.Y+_desktop.Y);_model.End();
        if(_startedEmpty&&Math.Abs(e.X-_down.X)<=3&&Math.Abs(e.Y-_down.Y)<=3&&_snapEnabled){var target=CaptureTargets.AtPoint(_snapTargets,e.X+_desktop.X,e.Y+_desktop.Y,_allowed,_snapClient);if(target is not null){_model.Set(target.Bounds);}}
        Capture=false;if(_model.HasArea)FinishSelection();else Invalidate();
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if(e.KeyCode==Keys.Escape){CancelSelection();return;}
        if(e.KeyCode==Keys.M&&!_handingOff){_magnifier=!_magnifier;Invalidate();e.Handled=true;return;}
    }
    private void FinishSelection() { if(!_model.HasArea||_model.Selection is not {} r)return;_trace?.Mark("selection_released");_handingOff=true;_magnifier=false;Cursor=Cursors.Default;_selected.TrySetResult(r);Invalidate(); }
    private void CancelSelection() { IsCancelled=true;_selected.TrySetResult(null);Close(); }
    protected override void OnPaint(PaintEventArgs e)
    {
        var g=e.Graphics;g.DrawImageUnscaled(_frozen,0,0);
        using var shade=new SolidBrush(SoftClayDrawing.Color("mask"));g.FillRectangle(shade,ClientRectangle);
        var displayed=_model.Selection??HoverTarget?.Bounds;
        if(displayed is {} r && r.Width>0 && r.Height>0)
        {
            var box=new Rectangle(r.X-_desktop.X,r.Y-_desktop.Y,r.Width,r.Height);g.DrawImage(_frozen,box,box,GraphicsUnit.Pixel);
            g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var scale=DeviceDpi/96f;
            using var glow=new Pen(Color.FromArgb(48,SoftClayDrawing.Color("accent")),6*scale);g.DrawRectangle(glow,box);
            using var pen=new Pen(SoftClayDrawing.Color("accent"),(float)SoftClayTheme.Number("size","selectionBorder")*scale);g.DrawRectangle(pen,box);
            foreach(var x in new[]{box.Left,box.Left+box.Width/2,box.Right})foreach(var y in new[]{box.Top,box.Top+box.Height/2,box.Bottom})
                if(x!=box.Left+box.Width/2||y!=box.Top+box.Height/2) {var diameter=(float)SoftClayTheme.Number("size","handle")*scale;
                    var handle=new RectangleF(x-diameter/2,y-diameter/2,diameter,diameter);
                    using var fill=new System.Drawing.Drawing2D.LinearGradientBrush(handle,Color.White,Color.FromArgb(215,222,233),90);
                    g.FillEllipse(fill,handle);g.DrawEllipse(pen,handle);}
            // 松手前后尺寸胶囊保持相同内容，避免交接时突然缩短。
            DrawHint(g,$"{r.Width} × {r.Height} px",box.X,box.Y-38);
        }
        else DrawHint(g,"拖动框选 · M 放大镜 · Esc / 右键取消",Math.Max(12,-_desktop.X+24),Math.Max(12,-_desktop.Y+24));
        if(_magnifier)DrawMagnifier(g);
        if(!_handingOff)
        {
            using var cross=new Pen(SoftClayDrawing.Color("focus"),1);
            g.DrawLine(cross,_pointer.X-8,_pointer.Y,_pointer.X+8,_pointer.Y);g.DrawLine(cross,_pointer.X,_pointer.Y-8,_pointer.X,_pointer.Y+8);
        }
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
    private void DrawHint(Graphics graphics,string text,int x,int y)
    {
        using var font=new Font("Microsoft YaHei UI",10);var size=graphics.MeasureString(text,font);
        x=Math.Clamp(x,0,Math.Max(0,ClientSize.Width-(int)size.Width-16));y=Math.Clamp(y,0,Math.Max(0,ClientSize.Height-(int)size.Height-12));
        graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        SoftClayDrawing.Surface(graphics,new RectangleF(x,y,size.Width+16,size.Height+12),(float)SoftClayTheme.Number("radius","pill"));
        using var ink=new SolidBrush(SoftClayDrawing.Color("ink"));graphics.DrawString(text,font,ink,x+8,y+6);
    }
}
