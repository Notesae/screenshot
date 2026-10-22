import { describe, expect, it } from 'vitest';
import { MotionClock, MotionSpring, liquidBridge, type MotionFrames } from './motion';

/** 确定帧源只推进待处理回调，验证结束后不遗留自循环。 */
function frames() {
  let time = 0, sequence = 0;
  const pending = new Map<number, (time: number) => void>();
  const source: MotionFrames = { now: () => time, request: frame => { pending.set(++sequence, frame); return sequence; }, cancel: id => { pending.delete(id); } };
  return { source, pending, advance(ms = 1000 / 60) { time += ms; const batch = [...pending.values()]; pending.clear(); batch.forEach(frame => frame(time)); } };
}
describe('v2 物理弹簧与生命周期', () => {
  it.each([30, 60, 144])('%iHz 下保持有界并收敛，重定向不丢失速度', hz => {
    const spring = new MotionSpring(); spring.to = 1;
    for (let i = 0; i < hz / 10; i++) spring.step(1 / hz, 'attention');
    const velocity = spring.v; spring.to = -1; expect(spring.v).toBe(velocity);
    for (let i = 0; i < hz * 3; i++) { spring.step(1 / hz, 'attention'); expect(Math.abs(spring.x)).toBeLessThan(1.3); }
    expect(spring.x).toBe(-1); expect(spring.moving).toBe(false);
  });
  it('休眠后的长帧不造成失控位移', () => {
    const spring = new MotionSpring(); spring.to = 1;
    spring.step(120, 'entry');
    expect(spring.x).toBeGreaterThan(0); expect(spring.x).toBeLessThan(1.2);
  });
  it('新命名弹簧取消旧完成回调并继承当前值', async () => {
    const f = frames(), clock = new MotionClock(f.source); let first = 0, redirected = NaN;
    const old = clock.spring('panel', value => { first = value; });
    f.advance(); f.advance(); f.advance();
    const current = first;
    const next = clock.spring('panel', value => { redirected = value; }, 0, -1);
    expect(redirected).toBe(current); expect(await old).toBe(false);
    for (let i = 0; i < 180; i++) f.advance();
    expect(await next).toBe(true); expect(redirected).toBe(-1);
    expect(f.pending.size).toBe(0);
  });
  it('减少动态立即到终态，清理全部旧时间线', async () => {
    const f = frames(), clock = new MotionClock(f.source); let opacity = 0;
    const exit = clock.tween('exit', 360, value => { opacity = value; });
    f.advance(); clock.setReduced(true);
    expect(await exit).toBe(true); expect(opacity).toBe(1); expect(clock.activeTracks).toBe(0);
    for (let i = 0; i < 10; i++) f.advance();
    expect(f.pending.size).toBe(0);
  });
  it('销毁外壳使等待中的成功退出失效', async () => {
    const f = frames(), clock = new MotionClock(f.source);
    const exit = clock.tween('exit', 360, () => {});
    f.advance(); clock.dispose();
    expect(await exit).toBe(false); expect(clock.activeTracks).toBe(0); expect(f.pending.size).toBe(0);
  });
  it('停稳五帧后休眠，新输入仍能唤醒', () => {
    const f = frames(), clock = new MotionClock(f.source);
    let paints = 0; clock.listen(() => { paints++; return false; });
    clock.wake(); for (let i = 0; i < 12; i++) f.advance();
    expect(paints).toBe(5); expect(f.pending.size).toBe(0);
    clock.wake(); f.advance(); expect(paints).toBe(6); clock.dispose();
  });
  it('绘制回调唤醒新轨道时仍只保留一个后续帧', () => {
    const f = frames(), clock = new MotionClock(f.source);
    let started = false;
    clock.tween('first', 60, progress => {
      if (progress > 0 && !started) {
        started = true;
        void clock.tween('second', 100, () => {});
      }
    });
    f.advance();
    expect(f.pending.size).toBe(1);
    for (let i = 0; i < 40; i++) f.advance();
    expect(f.pending.size).toBe(0); clock.dispose();
  });
  it('帧内停止或销毁后不能重新排队', () => {
    for (const dispose of [false, true]) {
      const f = frames(), clock = new MotionClock(f.source);
      clock.listen(() => { if (dispose) clock.dispose(); else clock.stop(); return true; });
      clock.wake(); f.advance();
      expect(f.pending.size).toBe(0); expect(clock.activeTracks).toBe(0);
    }
  });
  it('隐藏前结束表现过渡，但已取消的业务退出不能复活', async () => {
    const f = frames(), clock = new MotionClock(f.source);
    let panel = 0, menu = 0, exit = 0;
    const opening = clock.spring('panel', value => { panel = value; }, 0, -1);
    const closing = clock.tween('menu', 170, value => { menu = value; });
    const completion = clock.tween('exit', 360, value => { exit = value; });
    f.advance(); const interrupted = exit;
    clock.cancel('exit'); clock.finish(); clock.stop();
    expect(await opening).toBe(true); expect(panel).toBe(-1);
    expect(await closing).toBe(true); expect(menu).toBe(1);
    expect(await completion).toBe(false); expect(exit).toBe(interrupted);
    expect(clock.activeTracks).toBe(0); expect(f.pending.size).toBe(0);
  });
  it('归位回调替换另一个过渡后，不再绘制旧目标', async () => {
    const f = frames(), clock = new MotionClock(f.source);
    let replacement: Promise<boolean> | undefined, current = 0;
    clock.tween('first', 170, progress => {
      if (progress === 1) replacement = clock.spring('second', value => { current = value; }, 3, 4);
    });
    const old = clock.tween('second', 170, value => { current = value; });
    clock.finish();
    expect(await old).toBe(false); expect(current).toBe(3);
    for (let i = 0; i < 180; i++) f.advance();
    expect(await replacement).toBe(true); expect(current).toBe(4);
    expect(f.pending.size).toBe(0);
  });
  it('首次绘制中停止，以及销毁后的新请求都不能残留帧', async () => {
    const f = frames(), clock = new MotionClock(f.source);
    const stopped = clock.tween('surface', 170, () => clock.stop());
    expect(await stopped).toBe(false); expect(f.pending.size).toBe(0);
    clock.dispose(); let paints = 0;
    expect(await clock.spring('late', () => { paints++; })).toBe(false);
    expect(await clock.tween('late', 170, () => { paints++; })).toBe(false);
    clock.wake(); expect(paints).toBe(0); expect(f.pending.size).toBe(0);
  });
  it('液桥不能越过大间距、换行或远离屏幕的槽位', () => {
    const a = { x: 0, y: 0, width: 36, height: 36 };
    expect(liquidBridge(a, { ...a, x: 42 })).toMatch(/^M/);
    expect(liquidBridge(a, { ...a, x: 90 })).toBe('');
    expect(liquidBridge(a, { ...a, x: 42, y: 60 })).toBe('');
  });
});
