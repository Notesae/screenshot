import type { LoadedImage } from './bridge';
export type Mode = 'raw' | 'beauty' | 'reflow';
// 标注只保存受支持字段，不恢复可以加载资源或执行行为的 Fabric 对象 JSON。
export type Annotation = { type: 'text' | 'rect'; left: number; top: number; width: number; height: number; scaleX: number; scaleY: number; angle: number; text: string; color: string; fontSize: number };
export type EditorState = { mode: Mode; padding: number; radius: number; background: string; shadow: boolean; text: string; title: string; fontSize: number; textWidth: number; annotations: Annotation[] };
export type ProjectDocument = { schemaVersion: 1; image: LoadedImage | null; editor: EditorState };
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export function defaultEditor(): EditorState { return { mode: 'raw', padding: 48, radius: 18, background: '#e9dfd1', shadow: true, text: '', title: '一段值得留下的文字', fontSize: 26, textWidth: 720, annotations: [] }; }
/** 原图与美化间按有效留白平移标注；对象回调已有完整坐标，文字重排保持卡片画布语义。 */
export function applyEditorChange(editor: EditorState, change: Partial<EditorState>): EditorState {
  const next = { ...editor, ...change };
  if (change.annotations !== undefined || editor.mode === 'reflow' || next.mode === 'reflow') return next;
  const delta = (next.mode === 'beauty' ? next.padding : 0) - (editor.mode === 'beauty' ? editor.padding : 0);
  if (delta) next.annotations = editor.annotations.map(annotation => ({ ...annotation, left: annotation.left + delta, top: annotation.top + delta }));
  return next;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目格式无效。');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('项目参数超出安全范围。');
  return value;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('项目文字格式或长度无效。');
  return value;
}
function color(value: unknown): string {
  const text = string(value, 7);
  if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error('项目颜色无效。');
  return text;
}
/** 校验本地位图来源与像素上限，载入流程还会核对实际解码尺寸。 */
export function parseImage(value: unknown): LoadedImage {
  const image = record(value);
  const dataUrl = string(image.dataUrl, MAX_IMAGE_BYTES * 1.4);
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(dataUrl)) throw new Error('仅接受本地 PNG、JPEG 或 WebP 图片。');
  const width = number(image.width, 1, 16000), height = number(image.height, 1, 16000);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > 40_000_000) throw new Error('图片不能超过 4000 万像素。');
  return { dataUrl, name: string(image.name, 240), width, height };
}
/** 通过白名单重建项目，拒绝未知版本、非法对象及越界参数。 */
export function parseDocument(value: unknown): ProjectDocument {
  const doc = record(value);
  if (doc.schemaVersion !== 1) throw new Error('不支持此项目版本。');
  const e = record(doc.editor);
  if (!['raw', 'beauty', 'reflow'].includes(String(e.mode)) || typeof e.shadow !== 'boolean' || !Array.isArray(e.annotations) || e.annotations.length > 100) throw new Error('项目编辑数据无效。');
  const annotations = e.annotations.map(value => {
    const a = record(value);
    if (a.type !== 'text' && a.type !== 'rect') throw new Error('不支持此标注类型。');
    return { type: a.type, left: number(a.left, -32000, 32000), top: number(a.top, -32000, 32000), width: number(a.width, 1, 16000), height: number(a.height, 1, 16000), scaleX: number(a.scaleX, .01, 100), scaleY: number(a.scaleY, .01, 100), angle: number(a.angle, -360, 360), text: string(a.text, 5000), color: color(a.color), fontSize: number(a.fontSize, 8, 240) } as Annotation;
  });
  const editor: EditorState = { mode: e.mode as Mode, padding: number(e.padding, 0, 200), radius: number(e.radius, 0, 100), background: color(e.background), shadow: e.shadow, text: string(e.text, 20000), title: string(e.title, 240), fontSize: number(e.fontSize, 14, 64), textWidth: number(e.textWidth, 360, 1400), annotations };
  const image = doc.image === null ? null : parseImage(doc.image);
  outputSize(image, editor);
  return { schemaVersion: 1, image, editor };
}
/** 计算各编辑意图的画布尺寸，并在分配导出内存前限制像素总量。 */
export function outputSize(image: LoadedImage | null, editor: EditorState, scale = 1) {
  const padding = editor.mode === 'beauty' ? editor.padding : 0;
  const width = editor.mode === 'reflow' ? editor.textWidth : (image?.width || 720) + padding * 2;
  const height = editor.mode === 'reflow' ? 156 + estimateLines(editor.title, width - 96, 34) * 44 + estimateLines(editor.text, width - 96, editor.fontSize) * editor.fontSize * 1.7 : (image?.height || 480) + padding * 2;
  if (width * scale > 16000 || height * scale > 16000 || width * height * scale * scale > 40_000_000) throw new Error('导出尺寸过大，请降低倍率或缩短文字。');
  return { width: Math.ceil(width), height: Math.ceil(height) };
}
function estimateLines(text: string, width: number, font: number) { return text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil([...line].length * font / width)), 0); }
