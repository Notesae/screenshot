import { Select } from './Select';
import { useState } from 'react';
import { native } from './bridge';
import {correctTranslationChunk,translationText} from './translationDocument';
import { copyText } from './textCopy';
import { ArrowDown, ArrowUp, Languages, ScanText, Settings2, X } from 'lucide-react';
import type { EditorState, ProjectDocument } from './document';
import type { Settings } from './bridge';
import { correctBlock, ocrText, reorderBlock, type LocalOcrStatus, type OcrData } from './ocr';
export type TextToolsProps = {
  document: ProjectDocument; update: (change: Partial<EditorState>, group?: string) => void;
  settings: Settings; providerId: string; setProviderId: (id: string) => void;
  targetLanguage: string; setTargetLanguage: (language: string) => void;
  ocrEngine: 'local' | 'cloud'; setOcrEngine: (engine: 'local' | 'cloud') => void; localStatus: LocalOcrStatus | null;
  onProbe:(kind:"text"|"image")=>void;
  translationProgress:{done:number;total:number;failed:number;pending:number;canRetry:boolean;errors:string[]}|null; onRetryTranslation:()=>void;
  busy: string; aiBusy: string; onAi: (kind: 'ocr' | 'translate') => void; onCancelOcr: () => void; onConfigure: () => void; onError: (error: unknown) => void; onCopyText: (text: string) => void; compact?: boolean;
};
/** 工作台与原位面板共用校对状态；自由全文编辑不悄悄改写源框。 */
export function TextTools(props: TextToolsProps) {
  const { document: doc, update, compact, busy, aiBusy } = props, editor = doc.editor;
  const [selectedId, setSelectedId] = useState(''), [mergeLines,setMergeLines] = useState(false);
  const [usage,setUsage]=useState<{requests:number;cached:number;input:number;output:number}|null>(null);
  const ocr = editor.ocr, selected = ocr?.blocks.find(block => block.id === selectedId) || ocr?.blocks[0];
  function commitBlocks(next: OcrData, group?: string) {
    const text = ocrText(next); if (text.length > 20000) { props.onError(new Error('全文不能超过20000字。')); return; }
    update({ ocr: next, text }, group);
  }
  const basisChanged = ocr && JSON.stringify(ocr.source) !== JSON.stringify({ crop: editor.crop, resize: editor.resize });
  const contentId = compact ? 'compact-text' : 'content';
  // 服务选择与设置按钮共用一行，标签在行外，避免下拉替换后挤压相邻操作。
  const providerControls = <div className="provider-choice"><label className="control-label" htmlFor={compact ? 'compact-provider' : 'provider'}>{props.ocrEngine === 'cloud' ? '识别与翻译服务' : '翻译服务'}</label><div className="compact-provider"><Select aria-label="AI 服务" id={compact ? 'compact-provider' : 'provider'} value={props.providerId} onChange={value=> props.setProviderId(value)}><option value="">请先配置服务</option>{props.settings.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select><button title="服务设置" aria-label="服务设置" disabled={!!busy} onClick={props.onConfigure}><Settings2/></button></div></div>;
  return <section className="text-tools" aria-label="文字与翻译工具">
    <details open={!editor.text}><summary>识别设置 · {props.ocrEngine === 'local' ? '本地离线' : '云端服务'}</summary>
    <label className="control-label">识别方式<Select aria-label="识别方式" value={props.ocrEngine} onChange={value=> props.setOcrEngine(value as 'local' | 'cloud')}><option value="local">本地 OCR · 离线</option><option value="cloud">云端 OCR · 所选服务</option></Select></label>
    {props.ocrEngine === 'local' && <p className="ai-note" role="status">{props.localStatus ? props.localStatus.available ? `本地模型已就绪 · ${props.localStatus.modelVersion}` : `本地识别不可用：${props.localStatus.message}${props.localStatus.missingFiles.length ? `（缺少 ${props.localStatus.missingFiles.join('、')}）` : ''}` : '正在查询本地模型状态；不会自动下载。'}</p>}
    {props.ocrEngine === 'cloud' && providerControls}

    </details>
    <p className="ai-note">{props.ocrEngine==='local'?'本地 OCR 离线运行；项目保留原图。':'点击识别才发送当前裁剪图，并先应用实色遮盖（旋转时保守扩大）。已识别文字仍需检查，项目保留原图。'}</p>
    <button className="wide-button" disabled={!!busy || !!aiBusy || !doc.image || (props.ocrEngine === 'local' && !props.localStatus?.available) || (props.ocrEngine === 'cloud' && !props.providerId)} onClick={() => props.onAi('ocr')}><ScanText/>{props.ocrEngine === 'local' ? '本地识别文字' : '云端识别文字'}</button>
    {aiBusy && <button className="compact-secondary" onClick={props.onCancelOcr}><X/>{aiBusy==='翻译文字'?'取消翻译':'取消识别'}</button>}
    {ocr && !ocr.blocks.length && <p className="inline-empty">尚未识别到文字，可调整范围后再试。</p>}
    {ocr && ocr.blocks.length > 0 && <details><summary>按源框校对 · {ocr.blocks.length} 块</summary><div className="ocr-correction"><strong>源框校对 · {ocr.blocks.length} 块</strong>{basisChanged && <p className="ai-note warning">当前裁剪或尺寸已改变。下方保留识别时源图坐标，需要时重新识别。</p>}
      {doc.image && <svg className="ocr-source" role="group" aria-label="OCR 源框" viewBox={`0 0 ${ocr.imageWidth} ${ocr.imageHeight}`}>
        <svg x="0" y="0" width={ocr.imageWidth} height={ocr.imageHeight} viewBox={`${ocr.source.crop?.x || 0} ${ocr.source.crop?.y || 0} ${ocr.source.crop?.width || doc.image.width} ${ocr.source.crop?.height || doc.image.height}`} preserveAspectRatio="none"><image href={doc.image.dataUrl} width={doc.image.width} height={doc.image.height}/></svg>
        {ocr.blocks.map((block, index) => <polygon key={block.id} points={block.polygon.map(p => `${p.x},${p.y}`).join(' ')} className={selected?.id === block.id ? 'selected' : ''} role="button" tabIndex={0} aria-label={`选择文字块 ${index + 1}`} onClick={() => setSelectedId(block.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(block.id); } }}/>)}</svg>}
      <Select aria-label="校对文字块" value={selected?.id || ''} onChange={value=> setSelectedId(value)}>{ocr.blocks.map((block, index) => <option key={block.id} value={block.id}>{index + 1}. {block.text.slice(0, 32) || '空块'}</option>)}</Select>
      {selected && <><p className="ocr-original">识别原文：{selected.originalText}</p><label className="control-label">当前块校正<textarea aria-label="当前块校正" maxLength={5000} value={selected.text} onChange={event => commitBlocks(correctBlock(ocr, selected.id, event.target.value), `ocr:${selected.id}`)}/></label><div className="ocr-order"><button disabled={selected.order === 0} onClick={() => commitBlocks(reorderBlock(ocr, selected.id, -1))}><ArrowUp/>上移</button><button disabled={selected.order === ocr.blocks.length - 1} onClick={() => commitBlocks(reorderBlock(ocr, selected.id, 1))}><ArrowDown/>下移</button></div></>}
      {ocrText(ocr) !== editor.text && <p className="ai-note">全文已独立修改，源框文字保持原校对。继续修改块会按阅读顺序重建全文。</p>}
    </div></details>}
    <label className="control-label text-label" htmlFor={contentId}>可校对的文字<span>{editor.text.length} / 20000</span></label><textarea id={contentId} maxLength={20000} value={editor.text} placeholder="输入文字或从图片中识别" onChange={event => update({ text: event.target.value })}/>
    <div className="text-copy-actions"><button disabled={!editor.text} onClick={()=>props.onCopyText(copyText(editor.text,mergeLines))}>复制原文</button><button disabled={!editor.translation} onClick={()=>props.onCopyText(copyText(editor.translation,mergeLines))}>复制译文</button></div>
    <details><summary>复制换行 · {mergeLines?'合并断行':'保留换行'}</summary><label className="control-label">复制文字换行<Select aria-label="复制文字换行" value={mergeLines?'merge':'keep'} onChange={value=>setMergeLines(value==='merge')}><option value="keep">保留换行</option><option value="merge">合并断行，保留空段</option></Select></label></details>
    <details className="translation-section"><summary>翻译与译文校对</summary>
    {/* details 的匿名内容层不能保证子项间距，使用真实容器组织设置、结果与诊断。 */}
    <div className="translation-content">
    {props.ocrEngine === 'local' && providerControls}
    <div className="translate-row"><label className="control-label">目标语言<Select aria-label={compact ? '目标语言' : '翻译目标语言'} value={props.targetLanguage} onChange={value=> props.setTargetLanguage(value)}><option>简体中文</option><option>English</option><option>日本語</option><option>한국어</option></Select></label><button className="clay-primary" disabled={!!busy || !!aiBusy || !editor.text.trim() || !props.providerId} onClick={() => props.onAi('translate')}><Languages/>翻译</button></div>
    {!props.providerId && <p className="ai-note">翻译需要先配置并选择服务；本地 OCR 无需配置服务。</p>}
    <p className="ai-note">发送上方原文，每 2000 字分块翻译。失败块可手动重试，服务商可能计费。</p>
    {props.translationProgress&&<div className="translation-progress" role="status">翻译进度 {props.translationProgress.done} / {props.translationProgress.total}{(props.translationProgress.failed>0||props.translationProgress.pending>0)&&<><p>{props.translationProgress.failed} 块失败 / {props.translationProgress.pending} 块未完成：{props.translationProgress.errors.join('；')}</p><button disabled={!!busy||!!aiBusy||!props.translationProgress.canRetry} onClick={props.onRetryTranslation}>{props.translationProgress.failed?'仅重试失败块':'继续未完成块'}</button>{!props.translationProgress.canRetry&&<p>文档已改变，请重新发起翻译。</p>}</>}</div>}
    <label className="control-label">可校对的译文<textarea aria-label="可校对的译文" value={editor.translation} maxLength={20000} placeholder="翻译结果保留在这里，不覆盖原文" onChange={event => update({ translation: event.target.value })}/></label>
    {editor.translation && editor.translationSource !== editor.text && <p className="ai-note warning" role="status">原文已修改或译文来源未确认；译文已过期，请重新翻译或校对。<button onClick={()=>update({translationSource:editor.text})}>已按当前原文校对</button></p>}
    {editor.translationData&&<div className="translation-blocks"><strong>持久化块译文 · {editor.translationData.chunks.filter(c=>c.status==='done').length}/{editor.translationData.chunks.length}</strong>{editor.translationData.source!==editor.text?<p className="ai-note warning">原文已改变，保留旧块译文并暂停源框对应；重新翻译时仅复用来源和服务配置均匹配的成功块。</p>:selected&&editor.translationData.chunks.filter(c=>c.sourceBlockId===selected.id).map((chunk,i)=><div key={chunk.id}><p className="ocr-original">生成译文：{chunk.generatedText??'尚未生成'}</p><label className="control-label">当前源块译文 {i+1}<textarea aria-label={`当前源块译文 ${i+1}`} value={chunk.text||''} maxLength={20000} onChange={event=>{try{const next=correctTranslationChunk(editor.translationData!,chunk.id,event.target.value);update({translationData:next,translation:translationText(next),translationSource:next.source},`translation-edit:${chunk.id}`);}catch(error){props.onError(error);}}}/></label></div>)}{editor.translation&&translationText(editor.translationData)!==editor.translation&&<p className="ai-note">全文译文已单独修改；继续校对块会按块顺序重建全文译文。</p>}</div>}

    <details className="provider-tests"><summary>服务测试与本次用量</summary><div className="provider-test-content"><p className="ai-note">测试仅在点击后发送固定样例，服务商可能计费。成功仅表示此次接口返回文字。</p><div className="text-copy-actions"><button disabled={!!busy||!!aiBusy||!props.providerId} onClick={()=>props.onProbe('text')}>测试文字接口</button><button disabled={!!busy||!!aiBusy||!props.providerId} onClick={()=>props.onProbe('image')}>测试图片接口</button></div><button className="usage-refresh" onClick={()=>{void native.request<{items:{cached:boolean;usage?:{inputTokens:number|null;outputTokens:number|null}}[]}>('ai.usage').then(({items})=>setUsage({requests:items.length,cached:items.filter(i=>i.cached).length,input:items.reduce((s,i)=>s+(i.usage?.inputTokens||0),0),output:items.reduce((s,i)=>s+(i.usage?.outputTokens||0),0)})).catch(props.onError);}}>刷新本次用量</button>{usage&&<p className="ai-note">最近 {usage.requests} 次 · 缓存 {usage.cached} 次 · 已报告输入 {usage.input} / 输出 {usage.output} token；缺失用量不推算费用，关闭程序后清空。</p>}</div></details>
    </div></details>
    <details><summary>生成文字卡片与排版</summary>
    <label className="control-label">卡片标题<input aria-label="卡片标题" maxLength={240} value={editor.title} onChange={event=>update({title:event.target.value})}/></label>
    <label className="control-label">文字大小<input aria-label="文字大小" type="number" min={14} max={64} value={editor.fontSize} onChange={event=>{const value=Number(event.target.value);if(value>=14&&value<=64)update({fontSize:value});}}/></label>
    <label className="control-label">卡片宽度<input aria-label="卡片宽度" type="number" min={360} max={1400} step={20} value={editor.textWidth} onChange={event=>{const value=Number(event.target.value);if(value>=360&&value<=1400)update({textWidth:value});}}/></label>
    <label className="control-label">正文行距<input aria-label="正文行距" type="number" min={1} max={3} step={0.1} value={editor.lineSpacing} onChange={e=>{ const value=Number(e.target.value); if(value>=1&&value<=3)update({lineSpacing:value}); }}/></label>
    <label className="control-label">段落间距<input aria-label="段落间距" type="number" min={0} max={80} value={editor.paragraphSpacing} onChange={e=>{ const value=Number(e.target.value); if(value>=0&&value<=80)update({paragraphSpacing:value}); }}/></label>
    <label className="control-label">文字卡片布局<Select aria-label="文字卡片布局" value={editor.textLayout} onChange={value=> update({ textLayout: value as EditorState['textLayout'], mode: 'reflow' })}><option value="source">仅原文</option><option value="translated">仅译文</option><option value="parallel">双语并排</option><option value="stacked">双语上下</option></Select></label><button className="compact-secondary" onClick={() => update({ mode: editor.mode === 'reflow' ? 'raw' : 'reflow' })}>{editor.mode === 'reflow' ? '返回原图' : '生成文字卡片'}</button>
    </details>
  </section>;
}
