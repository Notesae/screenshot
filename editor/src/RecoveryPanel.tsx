import { ControlButton } from './ControlMotion';
import { useEffect, useState } from 'react';
import { native } from './bridge';
import { parseRecoveryItems, type RecoveryItem } from './recovery';
/** 仅显式展开列表和选取恢复；不自动加载任何私人内容。 */
export function RecoveryPanel({ onRestore, onError, compact = false, autoOpen=false }: { onRestore: (item: RecoveryItem) => Promise<void>; onError: (error: unknown) => void; compact?: boolean; autoOpen?:boolean }) {
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
      const result = await native.request<{ deleted: boolean }>('recovery.delete', { documentId: item.documentId });
      if (!result.deleted) throw new Error('未找到要删除的恢复记录。');
      setItems(current => current.filter(value => value.documentId !== item.documentId));setUsage(await native.request("recovery.usage"));
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  async function removeSelected() {
    setBusy(true);const deleting=[...selected];
    try {
      await native.request('recovery.deleteMany',{documentIds:deleting});
      setItems(items=>items.filter(item=>!deleting.includes(item.documentId)));setSelected([]);setConfirming(false);setUsage(await native.request('recovery.usage'));
    } catch(error){onError(error);}finally{setBusy(false);}
  }
  return <section className={`recovery-panel ${compact ? 'compact-recovery' : ''}`} aria-label="历史记录"><p className="ai-note">自动保存已关闭，这里仅显示以前保留的本机记录。</p><ControlButton className="compact-secondary" disabled={!native.available || busy} onClick={() => { if (open) setOpen(false); else void refresh(); }}>{open ? '收起恢复记录' : '查看恢复记录'}</ControlButton>{open && <div className="recovery-list">{usage&&<p className="ai-note">记录 {usage.documents} / {usage.maxDocuments} 条 · 去重原图 {(usage.referencedAssetBytes/1048576).toFixed(1)} / {(usage.maxAssetBytes/1048576).toFixed(0)} MiB（数据库及待清理文件另计）</p>}<ControlButton disabled={busy||!selected.length} onClick={()=>setConfirming(true)}>清理所选 {selected.length} 条</ControlButton>{confirming&&<div className="recovery-confirm" role="group" aria-label="确认批量清理"><p>删除所选本机恢复记录？当前编辑保留，不会重新自动保存。</p><ControlButton className="clay-danger" disabled={busy} onClick={()=>{void removeSelected();}}>确认清理所选记录</ControlButton><ControlButton onClick={()=>setConfirming(false)}>取消清理</ControlButton></div>}<p className="ai-note">记录仅存在本机。点击恢复才打开内容；删除记录不会删除当前编辑。</p>{!items.length && <p>暂无恢复记录。</p>}{items.map(item => <div className="recovery-item" data-document-id={item.documentId} key={item.documentId}><label><input type="checkbox" aria-label={`选择恢复记录 ${item.documentId}`} checked={selected.includes(item.documentId)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,item.documentId]:ids.filter(id=>id!==item.documentId))}/>选择</label><strong>{item.name || '未命名文档'}</strong><small>{item.updatedAtUtc} · r{item.revision}</small><div><ControlButton disabled={busy} onClick={async () => { setBusy(true); try { await onRestore(item); setOpen(false); } catch (error) { onError(error); } finally { setBusy(false); } }}>恢复</ControlButton><ControlButton className="clay-danger" disabled={busy} onClick={() => { void remove(item); }}>删除记录</ControlButton></div></div>)}</div>}</section>;
}
