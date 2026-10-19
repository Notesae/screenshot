using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Windows.Media.Imaging;

namespace Screenshot.App;
// 定义可替换的捕获后端，同时公开实际色彩能力供编辑器和验证记录使用。
public interface ICaptureBackend
{
    string Id { get; }
    bool SupportsHdr { get; }
    CapturedFrame? Capture(bool region);
}

// GDI SDR 兼容基线；后续 WGC 实现可替换此后端，不宣称支持 HDR。
public sealed class GdiCaptureBackend : ICaptureBackend
{
    public string Id => "gdi";
    public bool SupportsHdr => false;
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    // 先冻结整个虚拟桌面，再按用户选区裁剪，确保覆盖层不进入截图。
    public CapturedFrame? Capture(bool region)
    {
        var bounds = new Rectangle(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
        if (bounds.Width <= 0 || bounds.Height <= 0 || (long)bounds.Width * bounds.Height > 100_000_000) throw new InvalidOperationException("桌面尺寸无效或过大。");
        using var frozen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(frozen)) graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
        var desktop = new PixelRect(bounds.X, bounds.Y, bounds.Width, bounds.Height);
        var selected = desktop;
        if (region)
        {
            using var overlay = new RegionOverlay(frozen, bounds);
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
        return new(image, backdrop, desktop, selected, screens);
    }
    private static BitmapSource ReadFrozenBitmap(Bitmap bitmap)
    {
        using var stream = new MemoryStream(); bitmap.Save(stream, ImageFormat.Png); stream.Position = 0;
        var source = BitmapFrame.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        source.Freeze(); return source;
    }
}

// 在冻结图上呈现原生选区，使用物理像素坐标以保留多屏负坐标。
internal sealed class RegionOverlay : Form
{
    private readonly Bitmap _frozen;
    private readonly Rectangle _desktop;
    private Point? _start;
    private Point _end;
    public PixelRect Selection { get; private set; }
    // 关闭自动缩放，令窗口客户区与冻结图片保持相同的像素尺寸。
    public RegionOverlay(Bitmap frozen, Rectangle desktop)
    {
        _frozen = frozen; _desktop = desktop;
        AutoScaleMode = AutoScaleMode.None; FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual; Bounds = desktop;
        TopMost = true; ShowInTaskbar = false; DoubleBuffered = true; KeyPreview = true;
        Cursor = Cursors.Cross;
        Text = "Screenshot 区域选择";
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e); Bounds = _desktop; Activate(); }
    // 左键开始拖动并捕获鼠标，右键直接取消。
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Right) { DialogResult = DialogResult.Cancel; Close(); return; }
        if (e.Button != MouseButtons.Left) return;
        _start = e.Location; _end = e.Location; Capture = true; Invalidate();
    }
    protected override void OnMouseMove(MouseEventArgs e) { base.OnMouseMove(e); if (_start is not null) { _end = e.Location; Invalidate(); } }
    // 将客户区拖动坐标还原为虚拟桌面坐标，并忽略过小的误点击。
    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e); if (_start is null || e.Button != MouseButtons.Left) return;
        _end = e.Location; Capture = false;
        var start = _start.Value;
        Selection = CaptureGeometry.Selection(start.X + _desktop.X, start.Y + _desktop.Y, _end.X + _desktop.X, _end.Y + _desktop.Y, new(_desktop.X, _desktop.Y, _desktop.Width, _desktop.Height));
        if (Selection.Width < 2 || Selection.Height < 2) { _start = null; Invalidate(); return; }
        DialogResult = DialogResult.OK; Close();
    }
    protected override void OnKeyDown(KeyEventArgs e) { base.OnKeyDown(e); if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); } }
    // 以原始冻结图绘制高亮选区，遮暗其余区域并显示像素尺寸。
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.DrawImageUnscaled(_frozen, 0, 0);
        using var shade = new SolidBrush(Color.FromArgb(92, 0, 0, 0));
        e.Graphics.FillRectangle(shade, ClientRectangle);
        if (_start is { } start)
        {
            var rect = CaptureGeometry.Selection(start.X, start.Y, _end.X, _end.Y, new(0, 0, _frozen.Width, _frozen.Height));
            if (rect.Width > 0 && rect.Height > 0)
            {
                var box = new Rectangle(rect.X, rect.Y, rect.Width, rect.Height);
                e.Graphics.DrawImage(_frozen, box, box, GraphicsUnit.Pixel);
                using var pen = new Pen(Color.FromArgb(55, 175, 255), 2);
                e.Graphics.DrawRectangle(pen, box);
                DrawHint(e.Graphics, $"{rect.Width} × {rect.Height} px · 松开鼠标完成 · Esc 取消", Math.Max(10, rect.X), Math.Max(10, rect.Y - 38));
            }
        }
        else DrawHint(e.Graphics, "拖动选择区域 · Esc / 右键取消", Math.Max(12, -_desktop.X + 24), Math.Max(12, -_desktop.Y + 24));
    }
    // 把操作提示限制在覆盖层边界内，避免靠边选区时文字被截断。
    private void DrawHint(Graphics graphics, string text, int x, int y)
    {
        using var font = new Font("Microsoft YaHei UI", 11);
        var size = graphics.MeasureString(text, font);
        x = Math.Clamp(x, 0, Math.Max(0, ClientSize.Width - (int)size.Width - 16));
        y = Math.Clamp(y, 0, Math.Max(0, ClientSize.Height - (int)size.Height - 12));
        graphics.FillRectangle(Brushes.Black, x, y, size.Width + 16, size.Height + 12);
        graphics.DrawString(text, font, Brushes.White, x + 8, y + 6);
    }
}
