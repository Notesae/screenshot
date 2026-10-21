using System;

namespace Screenshot.App;

// 选区模型只处理物理像素，不调用系统捕获、窗口、输入或显示器枚举。
internal enum SelectionHandle { Create, Move, Left, Right, Top, Bottom, TopLeft, TopRight, BottomLeft, BottomRight }
internal sealed class RegionSelection(PixelRect bounds)
{
    public PixelRect? Selection { get; private set; }
    public bool HasArea => Selection is { Width: >= 2, Height: >= 2 };
    public bool Dragging { get; private set; }
    private int _startX, _startY;
    private PixelRect _before;
    private SelectionHandle _handle;

    public SelectionHandle HitTest(int x, int y, int tolerance = 6)
    {
        if (Selection is not { } r) return SelectionHandle.Create;
        var right = r.X + r.Width; var bottom = r.Y + r.Height;
        if (x < r.X - tolerance || x > right + tolerance || y < r.Y - tolerance || y > bottom + tolerance) return SelectionHandle.Create;
        var left = Math.Abs(x - r.X) <= tolerance && Math.Abs(x - r.X) <= Math.Abs(x - right);
        var edgeRight = !left && Math.Abs(x - right) <= tolerance;
        var top = Math.Abs(y - r.Y) <= tolerance && Math.Abs(y - r.Y) <= Math.Abs(y - bottom);
        var edgeBottom = !top && Math.Abs(y - bottom) <= tolerance;
        if (left && top) return SelectionHandle.TopLeft;
        if (edgeRight && top) return SelectionHandle.TopRight;
        if (left && edgeBottom) return SelectionHandle.BottomLeft;
        if (edgeRight && edgeBottom) return SelectionHandle.BottomRight;
        if (left) return SelectionHandle.Left;
        if (edgeRight) return SelectionHandle.Right;
        if (top) return SelectionHandle.Top;
        if (edgeBottom) return SelectionHandle.Bottom;
        return x >= r.X && x <= right && y >= r.Y && y <= bottom ? SelectionHandle.Move : SelectionHandle.Create;
    }
    public void Set(PixelRect rect)
    {
        var clipped=CaptureTargets.Intersect(rect,bounds);Selection=clipped.Width>=2&&clipped.Height>=2?clipped:null;Dragging=false;
    }
    public void Begin(int x, int y)
    {
        _handle = HitTest(x,y); _startX=x; _startY=y; _before=Selection ?? default; Dragging=true;
        if (_handle == SelectionHandle.Create) Selection=null;
    }
    // 所有拖动从按下时快照计算，避免多次移动累计舍入和边界漂移。
    public void Update(int x, int y)
    {
        if (!Dragging) return;
        var dx=x-_startX; var dy=y-_startY;
        if (_handle==SelectionHandle.Create) { Selection=CaptureGeometry.Selection(_startX,_startY,x,y,bounds); return; }
        if (_handle==SelectionHandle.Move) { Selection=Move(_before,dx,dy); return; }
        var left=_before.X;var top=_before.Y;var right=left+_before.Width;var bottom=top+_before.Height;
        if (_handle is SelectionHandle.Left or SelectionHandle.TopLeft or SelectionHandle.BottomLeft) left=Math.Clamp(left+dx,bounds.X,right-2);
        if (_handle is SelectionHandle.Right or SelectionHandle.TopRight or SelectionHandle.BottomRight) right=Math.Clamp(right+dx,left+2,bounds.X+bounds.Width);
        if (_handle is SelectionHandle.Top or SelectionHandle.TopLeft or SelectionHandle.TopRight) top=Math.Clamp(top+dy,bounds.Y,bottom-2);
        if (_handle is SelectionHandle.Bottom or SelectionHandle.BottomLeft or SelectionHandle.BottomRight) bottom=Math.Clamp(bottom+dy,top+2,bounds.Y+bounds.Height);
        Selection=new(left,top,right-left,bottom-top);
    }
    public void End() { Dragging=false; if (!HasArea) Selection=null; }
    public void Nudge(int dx, int dy, bool resize)
    {
        if (Dragging || !HasArea || Selection is not { } r) return;
        Selection=resize ? r with { Width=Math.Clamp(r.Width+dx,2,bounds.X+bounds.Width-r.X),Height=Math.Clamp(r.Height+dy,2,bounds.Y+bounds.Height-r.Y) } : Move(r,dx,dy);
    }
    private PixelRect Move(PixelRect r,int dx,int dy) => r with {
        X=Math.Clamp(r.X+dx,bounds.X,bounds.X+bounds.Width-r.Width),
        Y=Math.Clamp(r.Y+dy,bounds.Y,bounds.Y+bounds.Height-r.Height) };
}
