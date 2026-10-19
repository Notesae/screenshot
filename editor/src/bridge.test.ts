import { describe, it, expect, vi } from 'vitest';
import { NativeBridge } from './bridge';

describe('correlated native requests', () => {
  it('reports unavailable native features clearly', async () => {
    const bridge = new NativeBridge();
    await expect(bridge.request('capture.screen')).rejects.toThrow('桌面应用');
  });
  it('matches out-of-order replies and propagates host errors', async () => {
    const sent: any[] = [];
    const bridge = new NativeBridge(message => sent.push(message));
    const first = bridge.request('one');
    const second = bridge.request('two');
    bridge.receive({ id: sent[1].id, ok: true, result: 2 });
    bridge.receive({ id: sent[0].id, ok: false, error: { code: 'TEST', message: '失败原因' } });
    await expect(second).resolves.toBe(2);
    await expect(first).rejects.toThrow('失败原因');
    bridge.dispose();
  });
  it('times out and ignores late or unsolicited replies', async () => {
    vi.useFakeTimers();
    const bridge = new NativeBridge(() => {}, 20);
    const request = bridge.request('slow');
    const assertion = expect(request).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(() => bridge.receive({ id: 'unknown', ok: true })).not.toThrow();
    bridge.dispose();
    vi.useRealTimers();
  });
});
