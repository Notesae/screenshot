import type { LoadedImage } from './bridge';
export type Mode = 'raw' | 'beauty' | 'reflow';
// 标注只保存受支持字段，不恢复可以加载资源或执行行为的 Fabric 对象 JSON。
export type AnnotationKind = 'text' | 'rect' | 'arrow' | 'highlight' | 'cover';
export type Annotation = { id?: string; type: AnnotationKind; left: number; top: number; width: number; height: number; scaleX: number; scaleY: number; angle: number; text: string; color: string; fontSize: number };
export type SourceCrop = { x: number; y: number; width: number; height: number };
export type ContentResize = { width: number; height: number };
export type EditorState = { mode: Mode; padding: number; radius: number; background: string; shadow: boolean; text: string; title: string; fontSize: number; textWidth: number; annotations: Annotation[]; crop: SourceCrop | null; resize: ContentResize | null };
export type ProjectDocument = { schemaVersion: 1 | 2; image: LoadedImage | null; editor: EditorState };
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export function defaultEditor(): EditorState { return { mode: 'raw', padding: 48, radius: 18, background: '#e9dfd1', shadow: true, text: '', title: '一段值得留下的文字', fontSize: 26, textWidth: 720, annotations: [], crop: null, resize: null }; }
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
  if (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) throw new Error('不支持此项目版本。');
  const e = record(doc.editor);
  if (!['raw', 'beauty', 'reflow'].includes(String(e.mode)) || typeof e.shadow !== 'boolean' || !Array.isArray(e.annotations) || e.annotations.length > 100) throw new Error('项目编辑数据无效。');
  const annotations = e.annotations.map((value, index) => {
    const a = record(value);
    if (!['text', 'rect', 'arrow', 'highlight', 'cover'].includes(String(a.type))) throw new Error('不支持此标注类型。');
    const id = a.id === undefined ? `legacy-${index}` : string(a.id, 80);
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('标注标识无效。');
    return { id, type: a.type, left: number(a.left, -32000, 32000), top: number(a.top, -32000, 32000), width: number(a.width, 1, 16000), height: number(a.height, 1, 16000), scaleX: number(a.scaleX, .01, 100), scaleY: number(a.scaleY, .01, 100), angle: number(a.angle, -360, 360), text: string(a.text, 5000), color: color(a.color), fontSize: number(a.fontSize, 8, 240) } as Annotation;
  });
  const image = doc.image === null ? null : parseImage(doc.image);
  if (new Set(annotations.map(annotation => annotation.id)).size !== annotations.length) throw new Error('项目中存在重复标注标识。');
  const transform = parseTransform(image, doc.schemaVersion === 1 ? null : e.crop, doc.schemaVersion === 1 ? null : e.resize);
  const editor: EditorState = { mode: e.mode as Mode, padding: number(e.padding, 0, 200), radius: number(e.radius, 0, 100), background: color(e.background), shadow: e.shadow, text: string(e.text, 20000), title: string(e.title, 240), fontSize: number(e.fontSize, 14, 64), textWidth: number(e.textWidth, 360, 1400), annotations, ...transform };
  outputSize(image, editor);
  return { schemaVersion: 2, image, editor };
}
/** 计算各编辑意图的画布尺寸，并在分配导出内存前限制像素总量。 */
export function outputSize(image: LoadedImage | null, editor: EditorState, scale = 1) {
  const padding = editor.mode === 'beauty' ? editor.padding : 0;
  const content = contentGeometry(image, editor);
  const width = editor.mode === 'reflow' ? editor.textWidth : content.width + padding * 2;
  const height = editor.mode === 'reflow' ? 156 + estimateLines(editor.title, width - 96, 34) * 44 + estimateLines(editor.text, width - 96, editor.fontSize) * editor.fontSize * 1.7 : content.height + padding * 2;
  if (width * scale > 16000 || height * scale > 16000 || width * height * scale * scale > 40_000_000) throw new Error('导出尺寸过大，请降低倍率或缩短文字。');
  return { width: Math.ceil(width), height: Math.ceil(height) };
}
function estimateLines(text: string, width: number, font: number) { return text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil([...line].length * font / width)), 0); }

/** 裁剪始终指向不可变原图；缩放只记录尺寸，拒绝越界与非等比伪造项目。 */
function parseTransform(image: LoadedImage | null, cropValue: unknown, resizeValue: unknown): { crop: SourceCrop | null; resize: ContentResize | null } {
  let crop: SourceCrop | null = null, resize: ContentResize | null = null;
  if (cropValue !== null) {
    const c = record(cropValue); crop = { x: number(c.x, 0, 16000), y: number(c.y, 0, 16000), width: number(c.width, 1, 16000), height: number(c.height, 1, 16000) };
    if (!image || !Object.values(crop).every(Number.isInteger) || crop.x + crop.width > image.width || crop.y + crop.height > image.height) throw new Error('裁剪范围必须位于原图内。');
  }
  if (resizeValue !== null) {
    const r = record(resizeValue); resize = { width: number(r.width, 1, 16000), height: number(r.height, 1, 16000) };
    const source = crop || image;
    if (!source || !Object.values(resize).every(Number.isInteger) || resize.width * resize.height > 40_000_000 || Math.abs(resize.height - resize.width * source.height / source.width) > 1) throw new Error('缩放必须保持原图比例，且不超过4000万像素。');
  }
  return { crop, resize };
}
export function contentGeometry(image: LoadedImage | null, editor: EditorState) {
  const crop = editor.crop || { x: 0, y: 0, width: image?.width || 720, height: image?.height || 480 };
  return { crop, width: editor.resize?.width || crop.width, height: editor.resize?.height || crop.height };
}
/** 把标注从旧内容坐标映射到新内容坐标，保留旋转与原始图片引用，可完整撤销。 */
export function transformContent(document: ProjectDocument, crop: SourceCrop | null, resize: ContentResize | null): ProjectDocument {
  if (!document.image || document.editor.mode === 'reflow') throw new Error('请在原样或美化模式调整图片尺寸。');
  parseTransform(document.image, crop, resize);
  const old = contentGeometry(document.image, document.editor), nextEditor = { ...document.editor, crop, resize }, next = contentGeometry(document.image, nextEditor);
  const pad = document.editor.mode === 'beauty' ? document.editor.padding : 0;
  const xScale = (next.width / next.crop.width) / (old.width / old.crop.width), yScale = (next.height / next.crop.height) / (old.height / old.crop.height);
  nextEditor.annotations = document.editor.annotations.map(a => ({ ...a, left: pad + (a.left - pad) * xScale + (old.crop.x - next.crop.x) * next.width / next.crop.width, top: pad + (a.top - pad) * yScale + (old.crop.y - next.crop.y) * next.height / next.crop.height, scaleX: a.scaleX * xScale, scaleY: a.scaleY * yScale }));
  const validated = parseDocument({ ...document, schemaVersion: 2, editor: nextEditor });
  return { ...validated, image: document.image };
}
