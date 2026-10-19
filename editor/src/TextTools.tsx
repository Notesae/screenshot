import { useState } from 'react';
import { ArrowDown, ArrowUp, Languages, ScanText, Settings2, X } from 'lucide-react';
import type { EditorState, ProjectDocument } from './document';
import type { Settings } from './bridge';
import { correctBlock, ocrText, reorderBlock, type LocalOcrStatus, type OcrData } from './ocr';
export type TextToolsProps = {
  document: ProjectDocument; update: (change: Partial<EditorState>, group?: string) => void;
  settings: Settings; providerId: string; setProviderId: (id: string) => void;
  targetLanguage: string; setTargetLanguage: (language: string) => void;
  ocrEngine: 'local' | 'cloud'; setOcrEngine: (engine: 'local' | 'cloud') => void; localStatus: LocalOcrStatus | null;
  busy: string; aiBusy: string; onAi: (kind: 'ocr' | 'translate') => void; onCancelOcr: () => void; onConfigure: () => void; onError: (error: unknown) => void; compact?: boolean;
};
/** 工作台与原位面板共用校对状态；自由全文编辑不悄悄改写源框。 */
export function TextTools(props: TextToolsProps) {
  const { document: doc, update, compact, busy, aiBusy } = props, editor = doc.editor;
  const [selectedId, setSelectedId] = useState('');
  const ocr = editor.ocr, selected = ocr?.blocks.find(block => block.id === selectedId) || ocr?.blocks[0];
  function commitBlocks(next: OcrData, group?: string) {
    const text = ocrText(next); if (text.length > 20000) { props.onError(new Error('全文不能超过20000字。')); return; }
    update({ ocr: next, text }, group);
  }
  const basisChanged = ocr && JSON.stringify(ocr.source) !== JSON.stringify({ crop: editor.crop, resize: editor.resize });
  const contentId = compact ? 'compact-text' : 'content';
  return <section className="text-tools" aria-label="文字与翻译工具">
    <label className="control-label">识别方式<select aria-label="识别方式" value={props.ocrEngine} onChange={event => props.setOcrEngine(event.target.value as 'local' | 'cloud')}><option value="local">本地 OCR · 离线</option><option value="cloud">云端 OCR · 所选服务</option></select></label>
    {props.ocrEngine === 'local' && <p className="ai-note" role="status">{props.localStatus ? props.localStatus.available ? `本地模型已就绪 · ${props.localStatus.modelVersion}` : `本地识别不可用：${props.localStatus.message}${props.localStatus.missingFiles.length ? `（缺少 ${props.localStatus.missingFiles.join('、')}）` : ''}` : '正在查询本地模型状态；不会自动下载。'}</p>}
    <div className="compact-provider"><select aria-label="AI 服务" id={compact ? 'compact-provider' : 'provider'} value={props.providerId} onChange={event => props.setProviderId(event.target.value)}><option value="">请先配置服务</option>{props.settings.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><button title="服务设置" aria-label="服务设置" disabled={!!busy} onClick={props.onConfigure}><Settings2/></button></div>
    <p className="ai-note">本地 OCR 不联网。只有点击云端识别或翻译，才发送图片内容或文字给所选服务。</p>
    <button className="wide-button" disabled={!!busy || !!aiBusy || !doc.image || (props.ocrEngine === 'local' && !props.localStatus?.available)} onClick={() => props.onAi('ocr')}><ScanText/>{props.ocrEngine === 'local' ? '本地识别文字' : '云端识别文字'}</button>
    {aiBusy === '本地识别文字' && <button className="compact-secondary" onClick={props.onCancelOcr}><X/>取消识别</button>}
    {ocr && <div className="ocr-correction"><strong>源框校对 · {ocr.blocks.length} 块</strong>{basisChanged && <p className="ai-note warning">当前裁剪或尺寸已改变。下方保留识别时源图坐标，需要时重新识别。</p>}
      {doc.image && <svg className="ocr-source" role="group" aria-label="OCR 源框" viewBox={`0 0 ${ocr.imageWidth} ${ocr.imageHeight}`}>
        <svg x="0" y="0" width={ocr.imageWidth} height={ocr.imageHeight} viewBox={`${ocr.source.crop?.x || 0} ${ocr.source.crop?.y || 0} ${ocr.source.crop?.width || doc.image.width} ${ocr.source.crop?.height || doc.image.height}`} preserveAspectRatio="none"><image href={doc.image.dataUrl} width={doc.image.width} height={doc.image.height}/></svg>
        {ocr.blocks.map((block, index) => <polygon key={block.id} points={block.polygon.map(p => `${p.x},${p.y}`).join(' ')} className={selected?.id === block.id ? 'selected' : ''} role="button" tabIndex={0} aria-label={`选择文字块 ${index + 1}`} onClick={() => setSelectedId(block.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(block.id); } }}/>)}</svg>}
      <select aria-label="校对文字块" value={selected?.id || ''} onChange={event => setSelectedId(event.target.value)}>{ocr.blocks.map((block, index) => <option key={block.id} value={block.id}>{index + 1}. {block.text.slice(0, 32) || '空块'}</option>)}</select>
      {selected && <><p className="ocr-original">识别原文：{selected.originalText}</p><label className="control-label">当前块校正<textarea aria-label="当前块校正" maxLength={5000} value={selected.text} onChange={event => commitBlocks(correctBlock(ocr, selected.id, event.target.value), `ocr:${selected.id}`)}/></label><div className="ocr-order"><button disabled={selected.order === 0} onClick={() => commitBlocks(reorderBlock(ocr, selected.id, -1))}><ArrowUp/>上移</button><button disabled={selected.order === ocr.blocks.length - 1} onClick={() => commitBlocks(reorderBlock(ocr, selected.id, 1))}><ArrowDown/>下移</button></div></>}
      {ocrText(ocr) !== editor.text && <p className="ai-note">全文已独立修改，源框文字保持原校对。继续修改块会按阅读顺序重建全文。</p>}
    </div>}
    <label className="control-label text-label" htmlFor={contentId}>可校对的文字<span>{editor.text.length} / 20000</span></label><textarea id={contentId} maxLength={20000} value={editor.text} placeholder="输入文字或从图片中识别" onChange={event => update({ text: event.target.value })}/>
    <div className="translate-row"><select aria-label={compact ? '目标语言' : '翻译目标语言'} value={props.targetLanguage} onChange={event => props.setTargetLanguage(event.target.value)}><option>简体中文</option><option>English</option><option>日本語</option><option>한국어</option></select><button disabled={!!busy || !!aiBusy || !editor.text.trim()} onClick={() => props.onAi('translate')}><Languages/>翻译</button></div>
    <label className="control-label">可校对的译文<textarea aria-label="可校对的译文" value={editor.translation} maxLength={20000} placeholder="翻译结果保留在这里，不覆盖原文" onChange={event => update({ translation: event.target.value })}/></label>
    <label className="control-label">文字卡片布局<select aria-label="文字卡片布局" value={editor.textLayout} onChange={event => update({ textLayout: event.target.value as EditorState['textLayout'], mode: 'reflow' })}><option value="source">仅原文</option><option value="translated">仅译文</option><option value="parallel">双语并排</option><option value="stacked">双语上下</option></select></label><button className="compact-secondary" onClick={() => update({ mode: editor.mode === 'reflow' ? 'raw' : 'reflow' })}>{editor.mode === 'reflow' ? '返回原图' : '生成文字卡片'}</button>
  </section>;
}
export function CaptureBackendSelector({ backend, disabled, onChange }: { backend: 'wgc' | 'gdi' | null; disabled: boolean; onChange: (backend: 'wgc' | 'gdi') => void }) {
  return <label className="control-label capture-backend">捕获后端<select aria-label="捕获后端" value={backend || ''} disabled={disabled} onChange={event => onChange(event.target.value as 'wgc' | 'gdi')}><option disabled value="">查询中</option><option value="wgc">WGC</option><option value="gdi">GDI · 兼容</option></select><small>按钮与热键使用相同选择；失败会提示，不自动切换。</small></label>;
}
