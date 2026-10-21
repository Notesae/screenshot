import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Move } from 'lucide-react';
import { adjustSelection, type CaptureHandle } from './selectionGeometry';
import type { OverlayMetadata, PixelRect } from './overlay';

/** 编辑态选区外壳只传送坐标；冻结桌面及重新裁剪均由宿主负责。 */
export function CaptureSelection({ metadata, disabled, onAdjust, onPreview, onDragging }: {
  metadata: OverlayMetadata; disabled: boolean; onAdjust: (area: PixelRect) => void;
  onPreview: (area: PixelRect|null) => void; onDragging: (active: boolean) => void;
}) {
  const [preview, setPreview] = useState<PixelRect|null>(null);
  // 拖动快照与最近坐标同步保留，指针取消和 Esc 均可无副作用退回当前选区。
  const drag = useRef<{ id: number; x: number; y: number; handle: CaptureHandle; area: PixelRect; next: PixelRect; element: HTMLElement }|null>(null);
  const area = preview ?? metadata.selection, desktop = metadata.desktopBounds;
  const scale = { x: window.innerWidth / desktop.width, y: window.innerHeight / desktop.height };
  function cancel() {
    const current = drag.current; drag.current = null; setPreview(null); onPreview(null); onDragging(false);
    if (current?.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id);
  }
  function begin(handle: CaptureHandle, event: PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, handle, area: metadata.selection, next: metadata.selection, element: event.currentTarget };
    onDragging(true);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || event.pointerId !== current.id) return;
    current.next = adjustSelection(current.area, current.handle, (event.clientX-current.x)/scale.x, (event.clientY-current.y)/scale.y, desktop);
    setPreview(current.next); onPreview(current.next);
  }
  function end(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || event.pointerId !== current.id) return;
    move(event); const next = current.next; cancel();
    if (JSON.stringify(next) !== JSON.stringify(metadata.selection)) onAdjust(next);
  }
  // Esc 优先撤销当前手势；方向键以物理像素微调，不冒泡为工具或文档快捷键。
  function key(handle: CaptureHandle, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (disabled || drag.current || event.altKey || event.metaKey || event.nativeEvent.isComposing) return;
    const step = event.ctrlKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!delta[event.key]) return;
    event.preventDefault(); event.stopPropagation();
    const [dx, dy] = delta[event.key];
    onAdjust(adjustSelection(metadata.selection, event.shiftKey ? 'se' : handle, dx, dy, desktop));
  }
  return <div className="clay-capture-selection" aria-label="截图选区" style={{ left:(area.x-desktop.x)*scale.x, top:(area.y-desktop.y)*scale.y, width:area.width*scale.x, height:area.height*scale.y }}>
    <span className="clay-selection-size" aria-live="polite" style={{top:(area.y-desktop.y)*scale.y<38?6:undefined}}>{area.width} × {area.height} px</span>
    {(['nw','n','ne','e','se','s','sw','w','move'] as const).map(handle => <button key={handle} className={'clay-selection-handle is-'+handle} aria-label={handle==='move'?'移动截图选区':'调整截图选区 '+handle} title={handle==='move'?'拖动移动选区，方向键微调':'拖动调整选区，方向键微调'} disabled={disabled} onPointerDown={event=>begin(handle,event)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event=>key(handle,event)}>{handle==='move'&&<Move aria-hidden="true"/>}</button>)}
  </div>;
}
