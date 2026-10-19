import type { EditorState } from './document';
import { wrapParagraph } from './wrapText';
export type TextLayoutMode = 'source' | 'translated' | 'parallel' | 'stacked';
export type TextSection = { label: string; lines: string[]; offsets: number[]; height: number; x: number; y: number; width: number };
let measureContext: CanvasRenderingContext2D | null | undefined;
export const TEXT_FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
/** 保留每个换行与空段，并记录基线偏移；预览和高分辨率导出共享逻辑坐标。 */
function wrap(text: string, width: number, font: number, lineHeight: number, gap: number, bold = false) {
  if (measureContext === undefined) measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (measureContext) measureContext.font = `${bold ? '600 ' : ''}${font}px ${TEXT_FONT}`;
  const lines: string[] = [], offsets: number[] = []; let y = 0;
  const push = (line: string) => { lines.push(line); offsets.push(y); y += lineHeight; };
  text.split('\n').forEach((paragraph,index) => {
    if (index) y += gap;
    const measure = (text: string) => measureContext ? measureContext.measureText(text).width : [...text].length * font;
    for (const line of wrapParagraph(paragraph.replace(/\t/g,'    '), width, measure)) push(line);
  });
  return { lines, offsets, height:y };
}
/** 完整排版后计算高度；超出导出上限由文档层明确拒绝，绝不截断或无限缩字。 */
export function textLayout(editor: EditorState) {
  const width = editor.textWidth, font = editor.fontSize, lineHeight = font * editor.lineSpacing;
  const title = wrap(editor.title,width-96,32,44,0,true).lines, top = 78 + title.length * 44 + 30;
  const mode = editor.textLayout || 'source', dual = mode === 'parallel' || mode === 'stacked';
  const columnWidth = mode === 'parallel' ? (width - 120) / 2 : width - 96;
  const source = wrap(editor.text,columnWidth,font,lineHeight,editor.paragraphSpacing);
  const translated = wrap(editor.translation || '',columnWidth,font,lineHeight,editor.paragraphSpacing);
  const sections: TextSection[] = [];
  if (mode !== 'translated') sections.push({ ...source, label:dual ? '原文' : '', x:48, y:top+(dual?32:0), width:columnWidth });
  if (mode !== 'source') sections.push({ ...translated, label:dual ? '译文' : '', x:mode==='parallel'?72+columnWidth:48, y:mode==='stacked'?top+32+source.height+64:top+(dual?32:0), width:columnWidth });
  return { width, height:Math.ceil(Math.max(...sections.map(s=>s.y+s.height))+48), title, sections, lineHeight };
}
