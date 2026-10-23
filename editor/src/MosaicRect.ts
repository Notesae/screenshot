import { Rect, util } from 'fabric';

/** 从本帧已绘制的下层内容采样，矩形移动时重新打码，不携带旧位置或原图的快照。 */
export class MosaicRect extends Rect {
  // 以画布逻辑像素为单位，预览和放大导出使用同一强度。
  blockSize = 12;
  // 每个对象只持有低分辨率采样板；原图、译文和更早的标注统一来自当前合成画布。
  private readonly pixels = document.createElement('canvas');

  /** 必须直接绘入合成画布，禁用对象缓存才能读取这一帧真正位于马赛克下面的内容。 */
  override shouldCache() { this.ownCaching = false; return false; }

  /** 在设备像素中缩小再最近邻放大，局部裁切保留对象的旋转、缩放与导出倍率。 */
  override _render(ctx: CanvasRenderingContext2D) {
    const matrix = ctx.getTransform();
    const corners = [[-this.width / 2, -this.height / 2], [this.width / 2, -this.height / 2], [-this.width / 2, this.height / 2], [this.width / 2, this.height / 2]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    const left = Math.max(0, Math.floor(Math.min(...corners.map(point => point.x)))), top = Math.max(0, Math.floor(Math.min(...corners.map(point => point.y))));
    const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...corners.map(point => point.x)))), bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...corners.map(point => point.y))));
    if (right <= left || bottom <= top) return;
    // 去掉对象自身变换，只让块大小跟随画布倍率；拖动大小手柄不会把像素块拉成长条。
    const viewport = util.multiplyTransformMatrices([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], util.invertTransform(this.calcTransformMatrix()));
    const blockX = Math.max(1, this.blockSize * Math.hypot(viewport[0], viewport[1])), blockY = Math.max(1, this.blockSize * Math.hypot(viewport[2], viewport[3]));
    const columns = Math.max(1, Math.ceil((right - left) / blockX)), rows = Math.max(1, Math.ceil((bottom - top) / blockY));
    if (this.pixels.width !== columns) this.pixels.width = columns;
    if (this.pixels.height !== rows) this.pixels.height = rows;
    const sample = this.pixels.getContext('2d')!;
    sample.clearRect(0, 0, columns, rows);
    sample.imageSmoothingEnabled = true; sample.imageSmoothingQuality = 'high';
    sample.drawImage(ctx.canvas, left, top, right - left, bottom - top, 0, 0, this.pixels.width, this.pixels.height);
    ctx.save();
    ctx.beginPath(); ctx.rect(-this.width / 2, -this.height / 2, this.width, this.height); ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 有透明像素时也先覆盖下层，避免透明采样让未经打码的标注透出。
    ctx.fillStyle = '#30332e'; ctx.fillRect(left, top, right - left, bottom - top);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pixels, left, top, right - left, bottom - top);
    ctx.restore();
  }

  override dispose() { this.pixels.width = this.pixels.height = 0; super.dispose(); }
}
