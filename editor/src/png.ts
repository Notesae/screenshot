/** 编码私有画布快照并异步读取 Base64；桥和项目仍使用相同的无损 PNG data URL。 */
export function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('无法生成 PNG 图片，请稍后重试。')); return; }
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取 PNG 图片。'));
      reader.onerror = () => reject(new Error('无法读取 PNG 图片。'));
      reader.onabort = () => reject(new Error('PNG 图片读取已取消。'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}
