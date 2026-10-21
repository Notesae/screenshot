import { useEffect, useRef, useState } from 'react';
import { native } from './bridge';
import { AlertCircle, CheckCircle2, RotateCw } from 'lucide-react';
import { RecoveryWriter, parseRecoveryItems, type RecoveryItem, type RecoveryState, type RecoverySaveResult } from './recovery';
import type { ProjectDocument } from './document';
/** 后台保存不打开历史内容；每次打开新文档取消上一个去抖任务。 */
export function useRecovery(documentId: string, revision: number, document: ProjectDocument) {
  const [state, setState] = useState<RecoveryState>({ status: 'idle', message: native.available ? '尚无需要恢复的内容' : '浏览器模式不提供本机恢复库' });
  const [retry, setRetry] = useState(0);
  const writer = useRef<RecoveryWriter | null>(null);
  if (!writer.current) writer.current = new RecoveryWriter(snapshot => native.request<RecoverySaveResult>('recovery.save', snapshot), setState);
  useEffect(() => {
    // 初始修订0不占恢复记录；编辑或载入后即使清空全文，也要写入空快照覆盖旧内容。
    if (native.available && (revision > 0 || document.image || document.editor.text || document.editor.translation)) writer.current!.schedule({ documentId, revision, document });
    return () => writer.current!.cancel();
  }, [documentId, revision, document, retry]);
  return { ...state, retry: () => setRetry(value => value + 1), pause: () => writer.current!.pause(), resume: () => writer.current!.resume() };
}
export type RecoveryView = ReturnType<typeof useRecovery>;
/** 关键保存状态放在不滚动的区域；完整错误仍保留在恢复面板中。 */
export function RecoveryStatus({state}: {state:RecoveryView}) {
  const retry = state.status === 'unsaved' || state.status === 'paused';
  const label = state.status === 'unsaved' ? '尚未自动保存，请重试或保存项目。' : state.status === 'paused' ? '自动保存已暂停' : state.message;
  const Icon = retry ? AlertCircle : state.status === 'saved' ? CheckCircle2 : RotateCw;
  return <div className={`recovery-status state-${state.status}`} role={state.status === 'unsaved' ? 'alert' : 'status'}><Icon aria-hidden="true" size={14}/><span title={state.message}>{label}</span>{retry && <button onClick={state.retry}>{state.status === 'paused' ? '恢复自动保存' : '重试自动保存'}</button>}</div>;
}
/** 仅显式展开列表和选取恢复；不自动加载任何私人内容。 */
export function RecoveryPanel({ state, onRestore, onError, onDeleteCurrent, currentId, compact = false, autoOpen=false }: { state: ReturnType<typeof useRecovery>; onRestore: (item: RecoveryItem) => Promise<void>; onError: (error: unknown) => void; onDeleteCurrent: () => Promise<void>; currentId: string; compact?: boolean; autoOpen?:boolean }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<RecoveryItem[]>([]), [busy, setBusy] = useState(false);
  const [selected,setSelected]=useState<string[]>([]),[confirming,setConfirming]=useState(false),[usage,setUsage]=useState<{documents:number;referencedAssetBytes:number;maxDocuments:number;maxAssetBytes:number}|null>(null);
  async function refresh() {
    setBusy(true);
    try { setItems(parseRecoveryItems(await native.request('recovery.list'))); setUsage(await native.request('recovery.usage'));setSelected([]);setConfirming(false); setOpen(true); } catch (error) { onError(error); } finally { setBusy(false); }
  }
  useEffect(()=>{if(autoOpen)void refresh();},[autoOpen]);
  async function remove(item: RecoveryItem) {
    setBusy(true);
    try {
      await onDeleteCurrent();
      const result = await native.request<{ deleted: boolean }>('recovery.delete', { documentId: item.documentId });
      if (!result.deleted) throw new Error('未找到要删除的恢复记录。');
      setItems(current => current.filter(value => value.documentId !== item.documentId));setUsage(await native.request("recovery.usage"));
      if (item.documentId !== currentId) { state.resume(); state.retry(); }
    } catch (error) { onError(error); } finally { state.resume(); setBusy(false); }
  }
  async function removeSelected() {
    setBusy(true);const deleting=[...selected];
    try {
      await onDeleteCurrent();
      await native.request('recovery.deleteMany',{documentIds:deleting});
      setItems(items=>items.filter(item=>!deleting.includes(item.documentId)));setSelected([]);setConfirming(false);setUsage(await native.request('recovery.usage'));
      if(!deleting.includes(currentId)){state.resume();state.retry();}
    } catch(error){onError(error);}finally{state.resume();setBusy(false);}
  }
  return <section className={`recovery-panel ${compact ? 'compact-recovery' : ''}`} aria-label="本机自动恢复"><p className={state.status === 'unsaved' ? 'save-state unsaved' : 'save-state'}>{state.message}</p><button className="compact-secondary" disabled={!native.available || busy} onClick={() => { if (open) setOpen(false); else void refresh(); }}>{open ? '收起恢复记录' : '查看恢复记录'}</button>{open && <div className="recovery-list">{usage&&<p className="ai-note">恢复 {usage.documents} / {usage.maxDocuments} 条 · 去重原图 {(usage.referencedAssetBytes/1048576).toFixed(1)} / {(usage.maxAssetBytes/1048576).toFixed(0)} MiB（数据库及待清理文件另计）</p>}<button disabled={busy||!selected.length} onClick={()=>setConfirming(true)}>清理所选 {selected.length} 条</button>{confirming&&<div role="group" aria-label="确认批量清理"><p>删除所选本机恢复记录？当前编辑保留，修改后可重新自动保存。</p><button disabled={busy} onClick={()=>{void removeSelected();}}>确认清理所选记录</button><button onClick={()=>setConfirming(false)}>取消清理</button></div>}<p className="ai-note">记录仅存在本机。点击恢复才打开内容；删除记录不会删除当前编辑。</p>{!items.length && <p>暂无恢复记录。</p>}{items.map(item => <div className="recovery-item" data-document-id={item.documentId} key={item.documentId}><label><input type="checkbox" aria-label={`选择恢复记录 ${item.documentId}`} checked={selected.includes(item.documentId)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,item.documentId]:ids.filter(id=>id!==item.documentId))}/>选择</label><strong>{item.name || '未命名文档'}</strong><small>{item.updatedAtUtc} · r{item.revision}</small><div><button disabled={busy} onClick={async () => { setBusy(true); try { await onRestore(item); setOpen(false); } catch (error) { onError(error); } finally { setBusy(false); } }}>恢复</button><button disabled={busy} onClick={() => { void remove(item); }}>删除记录</button></div></div>)}</div>}</section>;
}
