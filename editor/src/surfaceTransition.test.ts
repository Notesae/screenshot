import { describe, expect, it } from 'vitest';
import { SurfaceTransition } from './surfaceTransition';

const first = { x: 100, y: 240, width: 40, height: 36 }, target = { x: 480, y: 40, width: 360, height: 560 };

describe('v2 浮层连续几何', () => {
  it.each([30, 60, 144])('%iHz 重定向尺寸和切换内容都保留当前矩形及速度', hz => {
    const surface = new SurfaceTransition(first); surface.open(target);
    for (let n = 0; n < hz / 10; n++) surface.step(1 / hz);
    const box = surface.box, velocity = surface.velocity, material = surface.material, alpha = surface.alpha;
    const next = { x: 520, y: 90, width: 420, height: 260 };
    surface.open(next, true);
    expect(surface.box).toEqual(box); expect(surface.velocity).toEqual(velocity);
    expect(surface.material).toBe(material); expect(surface.alpha).toBe(alpha);
    for (let n = 0; n < hz * 3; n++) surface.step(1 / hz);
    expect(surface.box).toEqual(next); expect(surface.moving).toBe(false);
    expect(surface.alpha).toBe(1); expect(surface.material).toBe(1);
  });
  it.each([30, 60, 144])('%iHz 提前关闭继承速度且有界，重开连续并最终收束', hz => {
    const surface = new SurfaceTransition(first); surface.open(target); surface.step(1 / hz);
    const box = surface.box, speed = surface.velocity, material = surface.material, alpha = surface.alpha;
    surface.close(0, -1); surface.step(0);
    expect(surface.box).toEqual(box); expect(surface.velocity).toEqual(speed);
    expect(surface.material).toBe(material); expect(surface.alpha).toBe(alpha);
    surface.step(1 / hz);
    // 反向时允许原速度短暂向外延续，但位移不能超过该速度一步的距离。
    expect(surface.box.width).toBeLessThanOrEqual(box.width + Math.abs(speed.width) / hz);
    expect(surface.box.height).toBeLessThanOrEqual(box.height + Math.abs(speed.height) / hz);
    const closing = surface.box, velocity = surface.velocity;
    surface.open(target); expect(surface.box).toEqual(closing); expect(surface.velocity).toEqual(velocity);
    for (let n = 0; n < hz * 3; n++) surface.step(1 / hz);
    expect(surface.box).toEqual(target); expect(surface.moving).toBe(false);
    surface.close(0, -1);
    for (let n = 0; n < hz; n++) surface.step(1 / hz);
    expect(surface.moving).toBe(false); expect(surface.alpha).toBe(0); expect(surface.material).toBe(0);
    expect(surface.box.width).toBeCloseTo(target.width * .98);
    expect(surface.box.height).toBeCloseTo(target.height * .97);
  });
  it('入场中扩展内容只改目标，不把已完成百分比套在新尺寸上', () => {
    const surface = new SurfaceTransition(first); surface.open(target); surface.step(.05); surface.step(.05);
    const before = surface.box, speed = surface.velocity;
    surface.redirect({ ...target, height: 900 }); surface.step(0);
    expect(surface.box).toEqual(before); expect(surface.velocity).toEqual(speed);
    surface.finish(); expect(surface.box.height).toBe(900); expect(surface.alpha).toBe(1);
  });
  it('重复关闭不重启期限，手动放置和系统归位清掉剩余速度', () => {
    const surface = new SurfaceTransition(first); surface.open(target); surface.finish();
    surface.close(); surface.step(.05); surface.close(); surface.step(.05); surface.step(.05); surface.step(.02);
    expect(surface.moving).toBe(false); expect(surface.material).toBe(0);
    surface.open(target); surface.step(.03); surface.snap(first, true);
    expect(surface.box).toEqual(first); expect(Object.values(surface.velocity).every(value => value === 0)).toBe(true);
    expect(surface.moving).toBe(false);
  });
  it('已关闭表面的重测量不会重新启动不可见保留层', () => {
    const surface = new SurfaceTransition(first); surface.open(target); surface.finish();
    surface.close(); surface.finish(); surface.snap(target, false);
    surface.close(); surface.step(.016);
    expect(surface.moving).toBe(false); expect(surface.material).toBe(0); expect(surface.box).toEqual(target);
  });
});
