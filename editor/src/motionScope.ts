/** 不可见宿主也包括等待新截图交接；不能只依赖浏览器的 visibilitychange。 */
export function motionSuspended(node: HTMLElement | null) {
  const root = node?.closest('.clay-editor');
  return document.hidden || !!root && (root.classList.contains('is-awaiting') || root.classList.contains('is-suspended'));
}

export function observeMotionScope(node: HTMLElement | null, update: (suspended: boolean) => void) {
  const refresh = () => update(motionSuspended(node)), root = node?.closest('.clay-editor');
  const observer = new MutationObserver(refresh);
  if (root) observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', refresh); refresh();
  return () => { observer.disconnect(); document.removeEventListener('visibilitychange', refresh); };
}
