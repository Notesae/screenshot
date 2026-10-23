import { MotionRange } from './MotionRange';
import { ControlButton } from './ControlMotion';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { containsScrollTarget } from './OverlayScrollbars';
import { useSurfaceMotion } from './SurfaceMotion';
import { MotionDetails } from './MotionDetails';

// 这些是可写入文档的色值，不是界面主题；所有入口共用同一组快捷颜色。
const SWATCHES = ['#ffffff', '#202022', '#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#a78bfa', '#f5d9cf', '#cbd5e1'];

/** 应用内取色代替系统颜色弹窗；仅确认合法颜色后才修改文档。 */
export function ColorField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (color: string) => void }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value), [error, setError] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const mounted = useSurfaceMotion(open, popup, trigger.current, position.left + ":" + position.top);
  const preview = /^#[0-9a-f]{6}$/i.test(draft) ? draft : value;
  const channels = [1, 3, 5].map(offset => parseInt(preview.slice(offset, offset + 2), 16));
  function setChannel(index: number, channel: number) {
    const next = [...channels]; next[index] = channel;
    setDraft('#' + next.map(number => number.toString(16).padStart(2, '0')).join('')); setError(false);
  }
  function close(restoreFocus = false) { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); }
  function commit(candidate = draft) {
    if (trigger.current?.matches(':disabled')) { close(); return; }
    let color = candidate.trim();
    if (/^#[0-9a-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map(char => char + char).join('');
    if (!/^#[0-9a-f]{6}$/i.test(color)) { setError(true); input.current?.focus(); return; }
    onChange(color.toLowerCase()); close(true);
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); event.stopPropagation(); commit(); }
    const buttons = [...(popup.current?.querySelectorAll<HTMLButtonElement>('[data-swatch]') ?? [])];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 };
    const offset = offsets[event.key];
    if (index >= 0 && offset !== undefined) { event.preventDefault(); event.stopPropagation(); buttons[(index + offset + buttons.length) % buttons.length]?.focus(); }
  }
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    // 展开 RGB 或出现错误时重新适配位置；不移动工具栏或滚动整个编辑器。
    const place = () => {
      if (!trigger.current || !popup.current) return;
      const rect = trigger.current.getBoundingClientRect(), panel = popup.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.width - 8));
      const top = Math.max(8, rect.bottom + panel.height + 14 <= window.innerHeight ? rect.bottom + 6 : rect.top - panel.height - 6);
      setPosition(current => current.left === left && current.top === top ? current : { left, top });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(popup.current);
    input.current?.focus({ preventScroll: true }); input.current?.select();
    return () => observer.disconnect();
  }, [open, mounted]);
  useEffect(() => {
    if (open && trigger.current?.matches(':disabled')) setOpen(false);
  });
  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); return; }
    const outside = (event: Event) => { if (!trigger.current?.contains(event.target as Node) && !containsScrollTarget(popup.current, event.target)) close(); };
    const moved = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside);
    window.addEventListener('resize', moved); window.addEventListener('scroll', moved, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); window.removeEventListener('resize', moved); window.removeEventListener('scroll', moved, true); };
  }, [open, disabled]);
  return <>
    <ControlButton ref={trigger} type="button" className="clay-color-trigger" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (open) close(); else { setDraft(value); setError(false); setOpen(true); } }}>
      <span className="clay-color-swatch" style={{ background: value }} aria-hidden="true"/><span>{value.toUpperCase()}</span>
    </ControlButton>
    {mounted && createPortal(<div ref={popup} id={id} role="dialog" aria-hidden={!open} inert={!open} aria-label={label} className="clay-color-popover" style={position} onKeyDown={navigate}>
      <div className="liquid-surface-skin" aria-hidden="true"/><div className="liquid-surface-content">
      <label htmlFor={id + '-hex'}>颜色值<input ref={input} id={id + '-hex'} value={draft} maxLength={7} autoComplete="off" spellCheck={false} aria-invalid={error || undefined} aria-describedby={id + '-hint'} onChange={event => { setDraft(event.target.value); setError(false); }}/></label>
      <div className="clay-color-options" role="group" aria-label="快捷颜色">{SWATCHES.map(color => <ControlButton key={color} type="button" data-swatch aria-label={color} aria-pressed={color.toLowerCase() === value.toLowerCase()} onClick={() => commit(color)}><span className="clay-color-swatch" style={{ background: color }} aria-hidden="true"/></ControlButton>)}</div>
      <MotionDetails><summary>精调 RGB</summary><div className="clay-color-channels">{['红', '绿', '蓝'].map((label, index) => <label key={label} className="clay-range"><span>{label}<output>{channels[index]}</output></span><MotionRange aria-label={label + '色通道'} min={0} max={255} value={channels[index]} style={{ '--range-progress': `${channels[index] / 255 * 100}%` } as CSSProperties} onChange={event => setChannel(index, Number(event.target.value))}/></label>)}</div></MotionDetails>
      <p id={id + '-hint'} className={error ? 'field-error' : 'clay-hint'} role={error ? 'alert' : undefined}>{error ? '请输入有效颜色，例如 #3B82F6。' : '支持 #RGB 或 #RRGGBB。'}</p>
      <ControlButton type="button" className="clay-primary" onClick={() => commit()}>应用颜色</ControlButton>
    </div></div>, trigger.current?.closest('.clay-editor') ?? document.body)}
  </>;
}
