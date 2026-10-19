import { expect, it, vi } from 'vitest';
import { defaultEditor } from './document';
import { recoveryRevision, RecoveryWriter, type RecoveryState } from './recovery';
it('debounces snapshots and ignores old save acknowledgements and reports failure', async () => {
  vi.useFakeTimers();
  const states: RecoveryState[] = [], replies: ((value: {saved: boolean; stale: boolean}) => void)[] = [];
  const send = vi.fn((_snapshot: import('./recovery').RecoverySnapshot) => new Promise<{saved: boolean; stale: boolean}>(resolve => replies.push(resolve)));
  const writer = new RecoveryWriter(send, state => states.push(state), 10);
  const document = { schemaVersion: 2 as const, image: null, editor: defaultEditor() };
  writer.schedule({ documentId: 'a', revision: 1, document }); writer.schedule({ documentId: 'a', revision: 2, document });
  await vi.advanceTimersByTimeAsync(10); expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].revision).toBe(2);
  writer.schedule({ documentId: 'b', revision: 3, document }); replies[0]({saved:true,stale:false}); await Promise.resolve(); expect(states.at(-1)?.status).toBe('pending');
  await vi.advanceTimersByTimeAsync(10); replies[1]({saved:false,stale:true}); await Promise.resolve(); expect(states.at(-1)?.status).toBe('unsaved');
  writer.pause(); expect(states.at(-1)?.status).toBe('paused'); vi.useRealTimers();
});
it('restoration advances past persisted revision and rejects unsafe revision', () => { expect(recoveryRevision(2, 80)).toBe(81); expect(recoveryRevision(100, 80)).toBe(101); expect(() => recoveryRevision(1, Infinity)).toThrow(); });
it('keeps only one in-flight write, queues latest revision and pause waits before delete', async () => {
  vi.useFakeTimers();
  const replies: ((value: {saved: boolean; stale: boolean}) => void)[] = [];
  const send = vi.fn((_snapshot: import('./recovery').RecoverySnapshot) => new Promise<{saved:boolean;stale:boolean}>(resolve => replies.push(resolve)));
  const writer = new RecoveryWriter(send, () => {}, 10), document = {schemaVersion:2 as const,image:null,editor:defaultEditor()};
  writer.schedule({documentId:'a',revision:1,document}); await vi.advanceTimersByTimeAsync(10);
  writer.schedule({documentId:'a',revision:2,document}); await vi.advanceTimersByTimeAsync(10);
  writer.schedule({documentId:'a',revision:3,document}); await vi.advanceTimersByTimeAsync(10); expect(send).toHaveBeenCalledTimes(1);
  replies[0]({saved:true,stale:false}); await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0].revision).toBe(3);
  writer.schedule({documentId:'a',revision:4,document}); await vi.advanceTimersByTimeAsync(10);
  let paused=false; const waiting=writer.pause().then(()=>{paused=true;}); expect(paused).toBe(false);
  replies[1]({saved:true,stale:false}); await waiting; await vi.advanceTimersByTimeAsync(10); expect(paused).toBe(true); expect(send).toHaveBeenCalledTimes(2); vi.useRealTimers();
});
it('blocks edits scheduled while deletion is waiting and resumes only after release', async () => {
  vi.useFakeTimers(); let finish!: (value:{saved:boolean;stale:boolean}) => void;
  const send=vi.fn((_snapshot:import('./recovery').RecoverySnapshot)=>new Promise<{saved:boolean;stale:boolean}>(resolve=>{finish=resolve;}));
  const writer=new RecoveryWriter(send,()=>{},10),document={schemaVersion:2 as const,image:null,editor:defaultEditor()};
  writer.schedule({documentId:'a',revision:1,document});await vi.advanceTimersByTimeAsync(10);
  const paused=writer.pause();writer.schedule({documentId:'a',revision:2,document});await vi.advanceTimersByTimeAsync(20);expect(send).toHaveBeenCalledTimes(1);
  finish({saved:true,stale:false});await paused;await vi.advanceTimersByTimeAsync(10);expect(send).toHaveBeenCalledTimes(1);
  writer.resume();writer.schedule({documentId:'a',revision:3,document});await vi.advanceTimersByTimeAsync(10);expect(send).toHaveBeenCalledTimes(2);finish({saved:true,stale:false});await Promise.resolve();vi.useRealTimers();
});
it.each([false, true])('allocates newer storage revision on retry, including lost acknowledgement=%s', async loseReply => {
  vi.useFakeTimers();
  try {
    const states: RecoveryState[] = [], revisions: number[] = []; let stored = 0;
    // 模拟真实 Store：相同或更低修订拒绝；首次可在已提交后丢失答复。
    const send = vi.fn(async (snapshot: import('./recovery').RecoverySnapshot) => {
      revisions.push(snapshot.revision);
      if (snapshot.revision <= stored) return { saved: false, stale: true };
      stored = snapshot.revision;
      if (loseReply && revisions.length === 1) throw new Error('模拟提交成功但答复丢失');
      return { saved: true, stale: false };
    });
    const writer = new RecoveryWriter(send, state => states.push(state), 10), document = { schemaVersion: 2 as const, image: null, editor: defaultEditor() };
    writer.schedule({documentId:'a',revision:9,document}); await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.status).toBe(loseReply ? 'unsaved' : 'saved');
    writer.schedule({documentId:'a',revision:9,document}); await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.status).toBe('saved'); expect(revisions).toEqual([9,10]);
    writer.schedule({documentId:'a',revision:10,document}); await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.status).toBe('saved'); expect(revisions).toEqual([9,10,11]);
  } finally { vi.useRealTimers(); }
});
it('reports unsafe storage revision without sending or silently overflowing', async () => {
  vi.useFakeTimers();
  try {
    const states: RecoveryState[] = [], send = vi.fn(async () => ({saved:true,stale:false}));
    const writer = new RecoveryWriter(send, state => states.push(state), 10), document = {schemaVersion:2 as const,image:null,editor:defaultEditor()};
    writer.schedule({documentId:'a',revision:Number.MAX_SAFE_INTEGER,document}); await vi.advanceTimersByTimeAsync(10);
    expect(send).not.toHaveBeenCalled(); expect(states.at(-1)?.status).toBe('unsaved'); expect(states.at(-1)?.message).toMatch(/安全|上限/);
  } finally { vi.useRealTimers(); }
});
