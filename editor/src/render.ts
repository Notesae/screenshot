import { textLayout } from './textLayout';
import { processingMasks } from './processingPrivacy';
import { contentGeometry, outputSize, type ProjectDocument } from './document';
import { parseImage, MAX_IMAGE_BYTES } from './document';
import type { LoadedImage } from './bridge';

export const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
// 仅接收已校验的 data URL，解码失败时向界面提供错误。
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法解码，请选择有效图片。'));
    image.src = dataUrl;
  });
}
/** 生成预览与导出共用的底图，原样模式无装饰，美化与重排在此合成。 */
export async function renderBase(doc: ProjectDocument): Promise<HTMLCanvasElement> {
  const { image, editor } = doc;
  const size = outputSize(image, editor);
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d')!;
  if (editor.mode === 'reflow') {
    ctx.fillStyle = '#faf5eb'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#b4432c'; ctx.fillRect(48, 48, 36, 4);
    ctx.textBaseline = 'top'; ctx.fillStyle = '#302d27'; ctx.font = `600 32px ${FONT}`;
    const layout = textLayout(editor); let y = 78;
    for (const line of layout.title) { ctx.fillText(line, 48, y); y += 44; }
    for (const section of layout.sections) {
      if (section.label) { ctx.font = '600 14px ' + FONT; ctx.fillStyle = '#b4432c'; ctx.fillText(section.label, section.x, section.y - 30); }
      ctx.font = editor.fontSize + 'px ' + FONT; ctx.fillStyle = '#302d27';
      section.lines.forEach((line, index) => ctx.fillText(line, section.x, section.y + index * layout.lineHeight));
    }
    return canvas;
  }
  if (!image) return canvas;
  const source = await loadImage(image.dataUrl);
  if (source.naturalWidth !== image.width || source.naturalHeight !== image.height) throw new Error('图片尺寸与项目记录不符。');
  const content = contentGeometry(image, editor);
  const padding = editor.mode === 'beauty' ? editor.padding : 0;
  if (editor.mode === 'beauty') {
    ctx.fillStyle = editor.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (editor.shadow) { ctx.shadowColor = '#30271c55'; ctx.shadowBlur = Math.min(padding * .5, 32); ctx.shadowOffsetY = Math.min(padding * .2, 12); }
    ctx.fillStyle = '#faf5eb'; ctx.beginPath(); ctx.roundRect(padding, padding, content.width, content.height, Math.min(editor.radius, content.width / 2, content.height / 2)); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(padding, padding, content.width, content.height, Math.min(editor.radius, content.width / 2, content.height / 2)); ctx.clip();
  }
  ctx.drawImage(source, content.crop.x, content.crop.y, content.crop.width, content.crop.height, padding, padding, content.width, content.height);
  return canvas;
}

// 浏览器导入先限制文件大小，再解码并统一成宿主支持的 PNG。
export async function fileToImage(file: File) {
  if (file.size > 24 * 1024 * 1024) throw new Error('图片文件不能超过 24 MB。');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取文件。')); reader.readAsDataURL(file);
  });
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  const image = await loadImage(dataUrl);
  return normalizeImage({ dataUrl, name: file.name, width: image.naturalWidth, height: image.naturalHeight });
}

/** 核对声明尺寸并保留原始 PNG；JPEG/WebP 本地转为 PNG，保证项目跨宿主可打开。 */
export async function normalizeImage(value: LoadedImage): Promise<LoadedImage> {
  const image = parseImage(value);
  const decoded = await loadImage(image.dataUrl);
  if (decoded.naturalWidth !== image.width || decoded.naturalHeight !== image.height) throw new Error('图片尺寸与项目记录不符。');
  if (image.dataUrl.startsWith('data:image/png;base64,')) return image;
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.drawImage(decoded, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length > MAX_IMAGE_BYTES * 1.4) throw new Error('规范化后的 PNG 超过 24 MB，请选择较小图片。');
  return parseImage({ ...image, dataUrl });
}

/** OCR 只用当前内容和实色隐私遮盖；装饰与其他标注不参与，原图仍供本地编辑。 */
export async function imageForProcessing(doc: ProjectDocument): Promise<LoadedImage> {
  if (!doc.image) throw new Error('请先载入图片。');
  const masks = processingMasks(doc);
  if (!doc.editor.crop && !doc.editor.resize && !masks.length) return doc.image;
  const geometry = contentGeometry(doc.image, doc.editor);
  // 在原始分辨率遮住信息后才进行任何重采样，避免缩放先把敏感像素混入边缘。
  const editor = { ...doc.editor, mode: 'raw' as const, resize: null, annotations: [] };
  const source = await renderBase({ ...doc, editor });
  const ctx = source.getContext('2d')!;
  for (const mask of masks) { ctx.fillStyle = mask.color; ctx.fillRect(mask.x, mask.y, mask.width, mask.height); }
  let canvas = source;
  if (doc.editor.resize) {
    canvas = document.createElement('canvas'); canvas.width = geometry.width; canvas.height = geometry.height;
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return { dataUrl: canvas.toDataURL('image/png'), name: doc.image.name, width: canvas.width, height: canvas.height };
}
