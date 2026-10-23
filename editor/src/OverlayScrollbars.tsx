import { useLayoutEffect, useRef } from 'react';
import tokens from '../../design/soft-clay.tokens.json';

type Axis = { track:HTMLDivElement; thumb:HTMLDivElement; vertical:boolean; range:number; travel:number; offset:number };
type Entry = { element:HTMLElement; axes:Axis[]; timer:number; visible:boolean; hovering:boolean; dragging:boolean };
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const owners = new WeakMap<HTMLElement, HTMLElement>();

// 覆盖滑块虽然挂在根层，点击仍属于原弹层，不能被“外部点击关闭”误判。
export function containsScrollTarget(container:HTMLElement | null, target:EventTarget | null) {
  if (!container || !(target instanceof Node)) return false;
  if (container.contains(target)) return true;
  const track = target instanceof Element ? target.closest<HTMLElement>('.clay-scrollbar') : null;
  const owner = track ? owners.get(track) : null;
  return !!owner && container.contains(owner);
}

/** 只增加覆盖式滑块；滚轮、触摸和键盘仍由原滚动容器处理，不包裹或搬动内容。 */
export function OverlayScrollbars() {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = layer.current, root = host?.parentElement;
    if (!host || !root) return;
    const entries = new Map<HTMLElement, Entry>();
    let frame = 0, rescan = true;

    function schedule(scan = false) {
      rescan ||= scan;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (rescan) { rescan = false; discover(); }
        for (const entry of entries.values()) layout(entry);
      });
    }
    function hideLater(entry:Entry) {
      clearTimeout(entry.timer);
      if (entry.hovering || entry.dragging) return;
      entry.timer = window.setTimeout(() => {
        entry.visible = false;
        for (const axis of entry.axes) axis.track.classList.remove('is-visible');
      }, tokens.scroll.hideDelay);
    }
    function reveal(entry:Entry) {
      if (!entry.visible) {
        entry.visible = true;
        for (const axis of entry.axes) axis.track.classList.add('is-visible');
      }
      hideLater(entry);
      schedule();
    }
    function position(entry:Entry, axis:Axis) { return axis.vertical ? entry.element.scrollTop : entry.element.scrollLeft; }
    function scrollTo(entry:Entry, axis:Axis, value:number) {
      value = Math.max(0, Math.min(axis.range, value));
      if (axis.vertical) entry.element.scrollTop = value;
      else entry.element.scrollLeft = value;
      schedule();
    }

    function makeAxis(entry:Entry, vertical:boolean):Axis {
      const track = document.createElement('div'), thumb = document.createElement('div');
      track.className = `clay-scrollbar ${vertical ? 'is-vertical' : 'is-horizontal'}`;
      thumb.className = 'clay-scrollbar-thumb'; track.append(thumb); host!.append(track);
      owners.set(track, entry.element);
      const axis:Axis = { track, thumb, vertical, range:0, travel:0, offset:0 };
      let drag:{ pointer:number; coordinate:number; scroll:number } | undefined;
      track.onpointerenter = () => { entry.hovering = true; reveal(entry); };
      track.onpointerleave = () => { entry.hovering = false; hideLater(entry); };
      track.onwheel = event => {
        if (event.ctrlKey) return;
        const chosen = entry.axes.find(item => item.vertical === !event.shiftKey && item.range > 0) ?? axis;
        const delta = chosen.vertical ? event.deltaY : event.deltaX || event.deltaY;
        if (!delta) return;
        event.preventDefault(); event.stopPropagation();
        const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? (chosen.vertical ? entry.element.clientHeight : entry.element.clientWidth) : 1;
        scrollTo(entry, chosen, position(entry, chosen) + delta * unit); reveal(entry);
      };
      track.onpointerdown = event => {
        if (event.button !== 0 || axis.range <= 0 || axis.travel <= 0) return;
        event.preventDefault(); event.stopPropagation();
        reveal(entry);
        if (event.target !== thumb) {
          // 点击轨道沿用翻页语义；只有按住滑块才开始拖动。
          const rect = track.getBoundingClientRect(), point = vertical ? event.clientY - rect.top : event.clientX - rect.left;
          const page = vertical ? entry.element.clientHeight : entry.element.clientWidth;
          scrollTo(entry, axis, position(entry, axis) + (point < axis.offset ? -page : page) * .9);
          return;
        }
        drag = { pointer:event.pointerId, coordinate:vertical ? event.clientY : event.clientX, scroll:position(entry, axis) };
        entry.dragging = true; clearTimeout(entry.timer);
        track.classList.add('is-dragging'); track.setPointerCapture(event.pointerId);
      };
      track.onpointermove = event => {
        if (!drag || drag.pointer !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const delta = (vertical ? event.clientY : event.clientX) - drag.coordinate;
        if (axis.travel > 0) scrollTo(entry, axis, drag.scroll + delta * axis.range / axis.travel);
      };
      const finish = (event:PointerEvent) => {
        if (!drag || drag.pointer !== event.pointerId) return;
        drag = undefined; entry.dragging = false; track.classList.remove('is-dragging');
        if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
        const rect = track.getBoundingClientRect();
        entry.hovering = event.type !== 'pointercancel' && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        hideLater(entry);
      };
      track.onpointerup = finish; track.onpointercancel = finish; track.onlostpointercapture = finish;
      return axis;
    }

    const resized = new ResizeObserver(() => schedule(true));
    function remove(entry:Entry) {
      clearTimeout(entry.timer); resized.unobserve(entry.element);
      for (const axis of entry.axes) { owners.delete(axis.track); axis.track.remove(); }
      entries.delete(entry.element);
    }
    function discover() {
      const found = new Set<HTMLElement>();
      // 动态菜单、折叠内容、文本井与画布共用一层，不给文档导出或布局增加包装节点。
      for (const element of root!.querySelectorAll<HTMLElement>('*')) {
        if (!(element instanceof HTMLElement) || host!.contains(element) || !element.clientWidth || !element.clientHeight) continue;
        const style = getComputedStyle(element);
        const y = /auto|scroll|overlay/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        const x = /auto|scroll|overlay/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
        if (!y && !x) continue;
        found.add(element);
        if (!entries.has(element)) {
          const entry:Entry = { element, axes:[], timer:0, visible:false, hovering:false, dragging:false };
          entry.axes = [makeAxis(entry, true), makeAxis(entry, false)];
          entries.set(element, entry); resized.observe(element);
        }
      }
      for (const entry of entries.values()) if (!found.has(entry.element)) remove(entry);
    }

    function layout(entry:Entry) {
      // 浮卡整体变形期间不绘制根层滚动条，避免它脱离曲面；稳定后恢复原滚动位置。
      if(entry.element.closest('[inert],.liquid-panel-body[data-motion-running=true]')){for(const axis of entry.axes)axis.track.hidden=true;return;}
      const element = entry.element, rect = element.getBoundingClientRect();
      const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1, scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
      const left = rect.left + element.clientLeft * scaleX, top = rect.top + element.clientTop * scaleY;
      const width = element.clientWidth * scaleX, height = element.clientHeight * scaleY;
      const style = getComputedStyle(element);
      const hasY = /auto|scroll|overlay/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      const hasX = /auto|scroll|overlay/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      let clip = { left:0, top:0, right:window.innerWidth, bottom:window.innerHeight };
      // 滑块跟随原容器的可见区域，嵌套文本框滚出浮卡时不会漂在卡片外面。
      for (let parent = element.parentElement; parent && root!.contains(parent); parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/auto|scroll|overlay|hidden|clip/.test(parentStyle.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
        if (/auto|scroll|overlay|hidden|clip/.test(parentStyle.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      }
      const hidden = width <= 0 || height <= 0 || style.visibility !== 'visible' || !!element.closest('[hidden], [inert], [aria-hidden="true"]');
      for (const axis of entry.axes) {
        const inset = Math.max(2, Math.min(12, parseFloat(axis.vertical ? style.borderTopRightRadius : style.borderBottomLeftRadius) || 0));
        const length = Math.max(0, (axis.vertical ? height - (hasX ? tokens.scroll.thickness : 0) : width - (hasY ? tokens.scroll.thickness : 0)) - inset * 2);
        const viewport = axis.vertical ? element.clientHeight : element.clientWidth, extent = axis.vertical ? element.scrollHeight : element.scrollWidth;
        const thumbLength = Math.min(length, Math.max(tokens.scroll.minThumb, length * viewport / extent));
        axis.range = Math.max(0, extent - viewport); axis.travel = Math.max(0, length - thumbLength);
        axis.offset = axis.range ? Math.max(0, Math.min(axis.travel, position(entry, axis) / axis.range * axis.travel)) : 0;
        const x = axis.vertical ? left + width - tokens.scroll.thickness - 1 : left + inset;
        const y = axis.vertical ? top + inset : top + height - tokens.scroll.thickness - 1;
        const trackWidth = axis.vertical ? tokens.scroll.thickness : length, trackHeight = axis.vertical ? length : tokens.scroll.thickness;
        axis.track.hidden = hidden || !(axis.vertical ? hasY : hasX) || !length || x >= clip.right || x + trackWidth <= clip.left || y >= clip.bottom || y + trackHeight <= clip.top;
        Object.assign(axis.track.style, {
          left:`${x}px`, top:`${y}px`, width:`${trackWidth}px`, height:`${trackHeight}px`,
          clipPath:`inset(${Math.max(0, clip.top - y)}px ${Math.max(0, x + trackWidth - clip.right)}px ${Math.max(0, y + trackHeight - clip.bottom)}px ${Math.max(0, clip.left - x)}px)`
        });
        if (axis.vertical) { axis.thumb.style.height = `${thumbLength}px`; axis.thumb.style.transform = `translateY(${axis.offset}px)`; }
        else { axis.thumb.style.width = `${thumbLength}px`; axis.thumb.style.transform = `translateX(${axis.offset}px)`; }
      }
    }

    function closest(target:EventTarget | null) {
      for (let element = target instanceof Element ? target : null; element && root!.contains(element); element = element.parentElement) {
        const entry = entries.get(element as HTMLElement);
        if (entry) return entry;
      }
    }
    const activity = (event:Event) => {
      if (event.target instanceof Node && host.contains(event.target)) return;
      if (event instanceof KeyboardEvent && !scrollKeys.has(event.key)) return;
      const entry = closest(event.target);
      if (entry) reveal(entry);
    };
    const scrolled = (event:Event) => { const entry = entries.get(event.target as HTMLElement); if (entry) reveal(entry); schedule(); };
    const changed = new MutationObserver(records => {
      let scan=false,positionOnly=false;
      for(const record of records){
        if(host.contains(record.target))continue;
        const target=record.target instanceof Element?record.target:record.target.parentElement;
        if(!target||target.closest('.annotation-feedback'))continue;
        if(record.type==='attributes'&&record.attributeName==='style'){
          // 动效每帧写材质/图标样式，不能据此遍历整棵 DOM 并强制读取布局。
          if(target.matches('.liquid-skin,.liquid-glyph,.liquid-active,.liquid-rail-body,.liquid-sweep,.liquid-panel-skin,.liquid-surface-skin,.control-skin,.control-content,[data-motion-button],[data-control-button],[data-selection-handle],input[type=range],.clay-slider-fill,.clay-slider-thumb,.annotation-sample,.annotation-tool-glyph,.clay-selection-jelly,.clay-selection-size,.clay-translation-tools'))continue;
          if(target.matches('.liquid-panel-body,.liquid-panel-page,.liquid-panel-content,.liquid-surface-content,.clay-card,.clay-rail')){positionOnly=true;continue;}
        }
        scan=true;
      }
      if(scan||positionOnly)schedule(scan);
    });
    const resizedWindow = () => schedule(true), loaded = () => schedule(true);
    changed.observe(root, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class', 'style', 'hidden', 'inert', 'open'] });
    resized.observe(root);
    root.addEventListener('scroll', scrolled, true);
    root.addEventListener('pointermove', activity, true); root.addEventListener('wheel', activity, { passive:true, capture:true });
    root.addEventListener('keydown', activity, true); root.addEventListener('input', loaded, true); root.addEventListener('load', loaded, true);
    window.addEventListener('resize', resizedWindow);
    discover(); root.setAttribute('data-overlay-scrollbars', ''); schedule(true);
    return () => {
      changed.disconnect(); resized.disconnect(); cancelAnimationFrame(frame);
      for (const entry of entries.values()) remove(entry);
      root.removeAttribute('data-overlay-scrollbars');
      root.removeEventListener('scroll', scrolled, true); root.removeEventListener('pointermove', activity, true); root.removeEventListener('wheel', activity, true);
      root.removeEventListener('keydown', activity, true); root.removeEventListener('input', loaded, true); root.removeEventListener('load', loaded, true);
      window.removeEventListener('resize', resizedWindow);
    };
  }, []);
  return <div ref={layer} className="clay-scrollbar-layer" aria-hidden="true"/>;
}
