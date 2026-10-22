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
  it('液桥不能越过大间距、换行或远离屏幕的槽位', () => {
    const a = { x: 0, y: 0, width: 36, height: 36 };
    expect(liquidBridge(a, { ...a, x: 42 })).toMatch(/^M/);
    expect(liquidBridge(a, { ...a, x: 90 })).toBe('');
    expect(liquidBridge(a, { ...a, x: 42, y: 60 })).toBe('');
  });
});
