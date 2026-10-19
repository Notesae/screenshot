import { parseDocument, type ProjectDocument } from './document';
export type RecoveryItem = { documentId: string; revision: number; name: string; updatedAtUtc: string };
export type RecoverySnapshot = { documentId: string; revision: number; document: ProjectDocument };
export type RecoveryState = { status: 'idle' | 'pending' | 'saved' | 'unsaved' | 'paused'; message: string };
export type RecoverySaveResult = { saved: boolean; stale: boolean; cleanupPending?: boolean };
/** 恢复修订在服务版本之上推进，避免新会话从零开始的修订被判断为过期。 */
export function recoveryRevision(current: number, restored: number) {
  if (!Number.isSafeInteger(restored) || restored < 0 || restored >= Number.MAX_SAFE_INTEGER - 1) throw new Error('恢复修订号无效。');
  return Math.max(current + 1, restored + 1);
}
export function parseRecoveryItems(value: unknown): RecoveryItem[] {
  const items = (value as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length > 1000) throw new Error('恢复列表格式无效。');
  return items.map(item => {
    if (!item || typeof item.documentId !== 'string' || !/^[a-f0-9-]{36}$/i.test(item.documentId) || !Number.isSafeInteger(item.revision) || item.revision < 0 || typeof item.name !== 'string' || item.name.length > 240 || typeof item.updatedAtUtc !== 'string' || item.updatedAtUtc.length > 80) throw new Error('恢复条目格式无效。');
    return { documentId: item.documentId, revision: item.revision, name: item.name, updatedAtUtc: item.updatedAtUtc };
  });
}
/** 去抖只发送最新不可变快照；请求已发出后也不让旧答复改写新文档的保存提示。 */
export class RecoveryWriter {
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private saveRevision = 0;
  private deletionLocked = false;
  private queued?: { snapshot: RecoverySnapshot; sequence: number };
  private active: Promise<void> | null = null;
  constructor(private send: (snapshot: RecoverySnapshot) => Promise<RecoverySaveResult>, private notify: (state: RecoveryState) => void, private delay = 900) {}
  cancel() { clearTimeout(this.timer); this.queued = undefined; this.sequence++; }
  async pause() { this.deletionLocked = true; this.cancel(); this.notify({ status: 'paused', message: '自动保存已暂停；下次编辑后重新启用。' }); await this.active; }
  resume() { this.deletionLocked = false; }
  schedule(snapshot: RecoverySnapshot) {
    if (this.deletionLocked) { this.cancel(); return; }
    this.cancel(); const sequence = this.sequence;
    // 存储修订独立于历史修订；重试或丢回包后仍递增，取消的去抖允许留下空号。
    const revision = Math.max(this.saveRevision + 1, snapshot.revision);
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER - 1) {
      this.notify({ status: 'unsaved', message: '尚未保存：恢复修订号达到安全整数上限或无效，请另存项目后重新打开。' }); return;
    }
    this.saveRevision = revision; snapshot = { ...snapshot, revision };
    this.notify({ status: 'pending', message: '等待自动保存…' });
    this.timer = setTimeout(() => { this.queued = { snapshot, sequence }; void this.flush(); }, this.delay);
  }
  /** 串行落盘并合并在途期间的新快照；暂停会丢弃待发快照。 */
  private flush(): Promise<void> {
    if (this.active || !this.queued) return this.active || Promise.resolve();
    const { snapshot, sequence } = this.queued; this.queued = undefined;
    this.active = (async () => {
      try {
        const document = parseDocument(snapshot.document);
        const result = await this.send({ ...snapshot, document });
        if (sequence !== this.sequence) return;
        if (!result?.saved || result.stale) throw new Error(result?.stale ? '恢复库已有较新版本；当前更改尚未保存。' : '自动保存未确认。');
        this.notify({ status: 'saved', message: result.cleanupPending ? '已自动保存；旧文件回收稍后重试。' : '已自动保存到本机' });
      } catch (error) { if (sequence === this.sequence) this.notify({ status: 'unsaved', message: `尚未保存：${error instanceof Error ? error.message : '恢复库暂不可用。'}` }); }
    })().finally(() => { this.active = null; if (this.queued) void this.flush(); });
    return this.active;
  }
}
