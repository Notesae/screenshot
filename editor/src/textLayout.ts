import type { EditorState } from './document';
export type TextLayoutMode = 'source' | 'translated' | 'parallel' | 'stacked';
export type TextSection = { label: string; lines: string[]; x: number; y: number; width: number };
// 浏览器使用实际字体度量；纯测试使用保守字宽，预览和导出共享同一排版函数。
let measureContext: CanvasRenderingContext2D | null | undefined;
export const TEXT_FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
function lines(text: string, width: number, font: number): string[] {
  if (measureContext === undefined) measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (measureContext) measureContext.font = `${font}px ${TEXT_FONT}`;
  return text.split('\n').flatMap(paragraph => {
    const result: string[] = []; let line = '';
    for (const char of paragraph.replace(/\t/g, '    ')) {
      const measured = measureContext ? measureContext.measureText(line + char).width : [...line, char].length * font;
      if (line && measured > width) { result.push(line); line = ''; }
      line += char;
    }
    result.push(line); return result;
  });
}
/** 先完成全部原译文换行再计算高度，长文超安全像素上限时明确拒绝而非截断。 */
export function textLayout(editor: EditorState) {
  const width = editor.textWidth, font = editor.fontSize, lineHeight = font * 1.7;
  const title = lines(editor.title, width - 96, 32), top = 78 + title.length * 44 + 30;
  const mode = editor.textLayout || 'source', dual = mode === 'parallel' || mode === 'stacked';
  const columnWidth = mode === 'parallel' ? (width - 120) / 2 : width - 96;
  const source = lines(editor.text, columnWidth, font), translated = lines(editor.translation || '', columnWidth, font);
  const sections: TextSection[] = [];
  if (mode !== 'translated') sections.push({ label: dual ? '原文' : '', lines: source, x: 48, y: top + (dual ? 32 : 0), width: columnWidth });
  if (mode !== 'source') sections.push({ label: dual ? '译文' : '', lines: translated, x: mode === 'parallel' ? 72 + columnWidth : 48, y: mode === 'stacked' ? top + 32 + source.length * lineHeight + 64 : top + (dual ? 32 : 0), width: columnWidth });
  const height = Math.ceil(Math.max(...sections.map(section => section.y + section.lines.length * lineHeight)) + 48);
  return { width, height, title, sections, lineHeight };
}
