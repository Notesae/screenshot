using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
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
    // 先冻结整个虚拟桌面，再按用户选区裁剪，确保覆盖层不进入截图。
    public Task<CapturedFrame?> CaptureAsync(CaptureRequest request, CancellationToken token) => Task.FromResult(CaptureCore(request, token));

    // GDI 仅保留原桌面兼容流程，目标类型不支持时明确拒绝而不是伪装 WGC 能力。
    private CapturedFrame? CaptureCore(CaptureRequest request, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (request.Target.Kind != CaptureTargetKind.Desktop) throw new CaptureException("capture_target_unsupported", "GDI 兼容模式目前仅支持桌面与区域截图。");
        var region = request.Region;
        var bounds = new Rectangle(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
        if (bounds.Width <= 0 || bounds.Height <= 0 || (long)bounds.Width * bounds.Height > 100_000_000) throw new InvalidOperationException("桌面尺寸无效或过大。");
        using var frozen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(frozen)) graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
        var desktop = new PixelRect(bounds.X, bounds.Y, bounds.Width, bounds.Height);
        var selected = desktop;
        if (region)
        {
            using var overlay = new RegionOverlay(frozen, bounds, snapTargets: request.SnapWindows ? WindowsWindowTargets.Snapshot() : null, snapClient: request.SnapClientArea);
            if (overlay.ShowDialog() != DialogResult.OK) return null;
            selected = overlay.Selection;
        }
        if (selected.Width < 1 || selected.Height < 1) return null;
        var backdrop = ReadFrozenBitmap(frozen);
        using var cropped = frozen.Clone(new Rectangle(selected.X - bounds.X, selected.Y - bounds.Y, selected.Width, selected.Height), PixelFormat.Format32bppArgb);
        var image = NativeImages.FromBitmap(ReadFrozenBitmap(cropped), region ? "区域截图.png" : "桌面截图.png");
        var screens = new System.Collections.Generic.List<CaptureScreen>();
        foreach (var screen in Screen.AllScreens)
            screens.Add(new(new(screen.Bounds.X, screen.Bounds.Y, screen.Bounds.Width, screen.Bounds.Height), screen.Primary));
        token.ThrowIfCancellationRequested();
        return new(image, backdrop, desktop, selected, screens) { Backend = Id };
    }
    private static BitmapSource ReadFrozenBitmap(Bitmap bitmap)
    {
        using var stream = new MemoryStream(); bitmap.Save(stream, ImageFormat.Png); stream.Position = 0;
        var source = BitmapFrame.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        source.Freeze(); return source;
    }
}

// 在冻结图上调整选区；确认前不释放底图，也不再采集桌面。
internal sealed class RegionOverlay : Form
{
    private readonly Bitmap _frozen;
    private readonly Rectangle _desktop;
    private readonly RegionSelection _model;
    private Point _pointer;
    private bool _magnifier=true;
    private readonly System.Collections.Generic.IReadOnlyList<WindowSnapTarget> _snapTargets;
    private readonly PixelRect _allowed;
    private bool _snapEnabled,_snapClient;
    private WindowSnapTarget? _selectedSnap;
    private Point _down;
    private bool _startedEmpty;
    private WindowSnapTarget? HoverTarget=>_snapEnabled&&!_model.CanConfirm&&!_model.Dragging?CaptureTargets.AtPoint(_snapTargets,_pointer.X+_desktop.X,_pointer.Y+_desktop.Y,_allowed,_snapClient):null;
    public PixelRect Selection { get; private set; }
    public RegionOverlay(Bitmap frozen,Rectangle desktop,PixelRect? allowedSelection=null,System.Collections.Generic.IReadOnlyList<WindowSnapTarget>? snapTargets=null,bool snapClient=false)
    {
        _frozen=frozen;_desktop=desktop;_allowed=allowedSelection ?? new(desktop.X,desktop.Y,desktop.Width,desktop.Height);_model=new(_allowed);_snapTargets=snapTargets??Array.Empty<WindowSnapTarget>();_snapEnabled=_snapTargets.Count>0;_snapClient=snapClient;
        AutoScaleMode=AutoScaleMode.None;FormBorderStyle=FormBorderStyle.None;StartPosition=FormStartPosition.Manual;Bounds=desktop;
        TopMost=true;ShowInTaskbar=false;DoubleBuffered=true;KeyPreview=true;Cursor=Cursors.Cross;Text="Screenshot 区域选择";
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e);Bounds=_desktop;Activate(); }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if(e.Button==MouseButtons.Right){CancelSelection();return;}
        if(e.Button!=MouseButtons.Left)return;
        _selectedSnap=null;_down=e.Location;_startedEmpty=_model.HitTest(e.X+_desktop.X,e.Y+_desktop.Y)==SelectionHandle.Create;
        _model.Begin(e.X+_desktop.X,e.Y+_desktop.Y);_pointer=e.Location;Capture=true;Invalidate();
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);_pointer=e.Location;_model.Update(e.X+_desktop.X,e.Y+_desktop.Y);
        Cursor=_model.HitTest(e.X+_desktop.X,e.Y+_desktop.Y) switch {
            SelectionHandle.Move=>Cursors.SizeAll,
            SelectionHandle.Left or SelectionHandle.Right=>Cursors.SizeWE,
            SelectionHandle.Top or SelectionHandle.Bottom=>Cursors.SizeNS,
            SelectionHandle.TopLeft or SelectionHandle.BottomRight=>Cursors.SizeNWSE,
            SelectionHandle.TopRight or SelectionHandle.BottomLeft=>Cursors.SizeNESW,
            _=>Cursors.Cross };
        Invalidate();
    }
    // 松开后保留边界，允许再次拖动；Enter/双击才确认，Esc/右键取消。
    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);if(e.Button!=MouseButtons.Left||!_model.Dragging)return;
        _model.Update(e.X+_desktop.X,e.Y+_desktop.Y);_model.End();
        if(_startedEmpty&&Math.Abs(e.X-_down.X)<=3&&Math.Abs(e.Y-_down.Y)<=3&&_snapEnabled){var target=CaptureTargets.AtPoint(_snapTargets,e.X+_desktop.X,e.Y+_desktop.Y,_allowed,_snapClient);if(target is not null){_selectedSnap=System.Linq.Enumerable.First(_snapTargets,t=>t.Handle==target.Handle);_model.Set(target.Bounds);}}
        Capture=false;Invalidate();
    }
    protected override void OnMouseDoubleClick(MouseEventArgs e) { base.OnMouseDoubleClick(e);if(e.Button==MouseButtons.Left)ConfirmSelection(); }
    protected override bool IsInputKey(Keys keyData) => (keyData & Keys.KeyCode) is Keys.Left or Keys.Right or Keys.Up or Keys.Down || base.IsInputKey(keyData);
    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if(e.KeyCode==Keys.Escape){CancelSelection();return;}
        if(e.KeyCode==Keys.Enter){ConfirmSelection();e.Handled=true;return;}
        if(e.KeyCode==Keys.W){_snapEnabled=!_snapEnabled;Invalidate();e.Handled=true;return;}
        if(e.KeyCode==Keys.C){_snapClient=!_snapClient;if(_selectedSnap is {} selected){var area=CaptureTargets.Area(selected,_allowed,_snapClient);_model.Set(area??default);}Invalidate();e.Handled=true;return;}
        if(e.KeyCode==Keys.M){_magnifier=!_magnifier;Invalidate();e.Handled=true;return;}
        var step=e.Control?10:1;
        var delta=e.KeyCode switch { Keys.Left=>(-step,0),Keys.Right=>(step,0),Keys.Up=>(0,-step),Keys.Down=>(0,step),_=>(0,0) };
        if(delta!=(0,0)){_selectedSnap=null;_model.Nudge(delta.Item1,delta.Item2,e.Shift);e.Handled=true;e.SuppressKeyPress=true;Invalidate();}
    }
    private void ConfirmSelection() { if(!_model.CanConfirm||_model.Selection is not {} r)return;Selection=r;DialogResult=DialogResult.OK;Close(); }
    private void CancelSelection() { DialogResult=DialogResult.Cancel;Close(); }
    protected override void OnPaint(PaintEventArgs e)
    {
        var g=e.Graphics;g.DrawImageUnscaled(_frozen,0,0);
        using var shade=new SolidBrush(Color.FromArgb(92,0,0,0));g.FillRectangle(shade,ClientRectangle);
        var displayed=_model.Selection??HoverTarget?.Bounds;
        if(displayed is {} r && r.Width>0 && r.Height>0)
        {
            var box=new Rectangle(r.X-_desktop.X,r.Y-_desktop.Y,r.Width,r.Height);g.DrawImage(_frozen,box,box,GraphicsUnit.Pixel);
            using var pen=new Pen(Color.FromArgb(55,175,255),1);g.DrawRectangle(pen,box);
            foreach(var x in new[]{box.Left,box.Left+box.Width/2,box.Right})foreach(var y in new[]{box.Top,box.Top+box.Height/2,box.Bottom})
                if(x!=box.Left+box.Width/2||y!=box.Top+box.Height/2) {g.FillRectangle(Brushes.White,x-3,y-3,6,6);g.DrawRectangle(pen,x-3,y-3,6,6);}
            DrawHint(g,$"{r.Width} × {r.Height} px · 拖动调整 · 方向键微调 · Shift 调尺寸 · Enter/双击确认 · W 吸附 · C 窗口/客户区",box.X,box.Y-38);
        }
        else DrawHint(g,"拖动框选 / 单击吸附 · W 吸附开关 · C 窗口/客户区 · M 放大镜 · Esc / 右键取消",Math.Max(12,-_desktop.X+24),Math.Max(12,-_desktop.Y+24));
        if(_magnifier)DrawMagnifier(g);
    }
    // 放大镜只读取本次冻结图，最近邻放大显示真实像素；不访问系统指针或再次捕获。
    private void DrawMagnifier(Graphics g)
    {
        var source=new Rectangle(Math.Clamp(_pointer.X-7,0,Math.Max(0,_frozen.Width-15)),Math.Clamp(_pointer.Y-7,0,Math.Max(0,_frozen.Height-15)),Math.Min(15,_frozen.Width),Math.Min(15,_frozen.Height));
        var target=new Rectangle(Math.Clamp(_pointer.X+28,0,Math.Max(0,ClientSize.Width-128)),Math.Clamp(_pointer.Y+28,0,Math.Max(0,ClientSize.Height-156)),120,120);
        var state=g.Save();g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;g.PixelOffsetMode=System.Drawing.Drawing2D.PixelOffsetMode.Half;
        g.DrawImage(_frozen,target,source,GraphicsUnit.Pixel);g.Restore(state);g.DrawRectangle(Pens.White,target);
        var px=Math.Clamp(_pointer.X,0,_frozen.Width-1);var py=Math.Clamp(_pointer.Y,0,_frozen.Height-1);
        var centerX=target.X+(px-source.X)*target.Width/source.Width;var centerY=target.Y+(py-source.Y)*target.Height/source.Height;
        g.DrawRectangle(Pens.Red,centerX,centerY,Math.Max(1,target.Width/source.Width),Math.Max(1,target.Height/source.Height));
        var color=_frozen.GetPixel(px,py);DrawHint(g,$"{px+_desktop.X}, {py+_desktop.Y} · #{color.R:X2}{color.G:X2}{color.B:X2} · M 隐藏",target.X,target.Bottom+3);
    }
    private void DrawHint(Graphics graphics,string text,int x,int y)
    {
        using var font=new Font("Microsoft YaHei UI",11);var size=graphics.MeasureString(text,font);
        x=Math.Clamp(x,0,Math.Max(0,ClientSize.Width-(int)size.Width-16));y=Math.Clamp(y,0,Math.Max(0,ClientSize.Height-(int)size.Height-12));
        graphics.FillRectangle(Brushes.Black,x,y,size.Width+16,size.Height+12);graphics.DrawString(text,font,Brushes.White,x+8,y+6);
    }
}
