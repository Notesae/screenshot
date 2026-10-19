import type { ContentResize, SourceCrop } from './document';
// OCR 坐标属于识别时的内容图，不属于冻结桌面，也不随之后裁剪偷偷改变。
export type OcrBlock = { id: string; polygon: { x: number; y: number }[]; originalText: string; text: string; confidence: number | null; order: number };
export type OcrData = { modelVersion: string; imageWidth: number; imageHeight: number; source: { crop: SourceCrop | null; resize: ContentResize | null }; blocks: OcrBlock[] };
export type LocalOcrStatus = { available: boolean; modelVersion: string; message: string; missingFiles: string[] };
export type RequestStamp = { documentId: string; generation: number; revision: number; sequence: number };
export function requestMatches(a: RequestStamp, b: RequestStamp) { return a.documentId === b.documentId && a.generation === b.generation && a.revision === b.revision && a.sequence === b.sequence; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('OCR 数据无效。'); return value as Record<string, unknown>; }
function text(value: unknown, max: number) { if (typeof value !== 'string' || value.length > max) throw new Error('OCR 文字无效或过长。'); return value; }
function numeric(value: unknown, min: number, max: number) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('OCR 坐标或参数无效。'); return value; }
/** 对宿主结果和项目数据使用同一白名单；所有文字保持普通字符串。 */
export function parseOcr(value: unknown, source: OcrData['source']): OcrData {
  const data = object(value), width = numeric(data.imageWidth, 1, 16000), height = numeric(data.imageHeight, 1, 16000);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > 40_000_000 || !Array.isArray(data.blocks) || data.blocks.length > 1000) throw new Error('OCR 尺寸或文字块数量超限。');
  const blocks = data.blocks.map(item => {
    const b = object(item), id = text(b.id, 100);
    if (!/^[a-z0-9_-]+$/i.test(id) || !Array.isArray(b.polygon) || b.polygon.length !== 4) throw new Error('OCR 文字块标识或四边形无效。');
    const order = numeric(b.order, 0, 1000); if (!Number.isInteger(order)) throw new Error('OCR 阅读顺序无效。');
    return { id, polygon: b.polygon.map(point => { const p = object(point); return { x: numeric(p.x, 0, width), y: numeric(p.y, 0, height) }; }), originalText: text(b.originalText ?? b.text, 5000), text: text(b.text, 5000), confidence: b.confidence === null ? null : numeric(b.confidence, 0, 1), order };
  }).sort((a, b) => a.order - b.order);
  if (new Set(blocks.map(block => block.id)).size !== blocks.length || new Set(blocks.map(block => block.order)).size !== blocks.length || blocks.reduce((sum, block) => sum + block.text.length + block.originalText.length + 1, 0) > 40000) throw new Error('OCR 块重复或总文字过长。');
  return { modelVersion: text(data.modelVersion, 160), imageWidth: width, imageHeight: height, source, blocks };
}
export function ocrText(data: OcrData) { return data.blocks.map(block => block.text).join('\n'); }
export function correctBlock(data: OcrData, id: string, value: string): OcrData { if (value.length > 5000) throw new Error('单块文字不能超过5000字。'); return { ...data, blocks: data.blocks.map(block => block.id === id ? { ...block, text: value } : block) }; }
export function reorderBlock(data: OcrData, id: string, delta: number): OcrData {
  const blocks = [...data.blocks], index = blocks.findIndex(block => block.id === id), target = index + delta;
  if (index < 0 || target < 0 || target >= blocks.length) return data;
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return { ...data, blocks: blocks.map((block, order) => ({ ...block, order })) };
}
