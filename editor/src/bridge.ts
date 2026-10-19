// 图片只在宿主与本地编辑器之间传递；服务密钥不进入此协议。
export type LoadedImage = { dataUrl: string; name: string; width: number; height: number };
export type PublicProvider = { id: string; name: string; kind: string; model: string; baseUrl: string; hasApiKey: boolean; revision?:string };
export type Settings = { providers: PublicProvider[]; defaultProviderId?: string };
// 捕获 ID 用来拒绝旧界面排队的呈现切换，不属于可保存的项目内容。
export type PresentationResult = { presentation: 'overlay' | 'workbench' | 'hidden'; accepted?: boolean; captureId?: string | null };
export class NativeError extends Error { constructor(message:string,public code:string){super(message);} }
type Send = (message: { id: string; method: string; payload: object }) => void;
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

/** 管理并行请求的关联 ID、超时和宿主错误，不直接执行系统操作。 */
export class NativeBridge {
  private pending = new Map<string, Pending>();
  private sequence = 0;
  constructor(private send?: Send, private timeoutMs = 120000) {}
  get available() { return Boolean(this.send); }
  // 先登记等待项再发送，避免宿主立即回复时丢失关联。
  request<T = unknown>(method: string, payload: object = {}): Promise<T> {
    if (!this.send) return Promise.reject(new Error('此功能需要在 Windows 桌面应用中使用。'));
    const id = `editor-${Date.now()}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('操作超时，请检查服务或桌面应用后重试。'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.send!({ id, method, payload }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  // 忽略未知或过期 ID；错误回复与成功回复都会释放计时器。
  receive(message: unknown) {
    if (!message || typeof message !== 'object' || !('id' in message) || typeof message.id !== 'string') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    const reply = message as { id: string; ok?: boolean; result?: unknown; error?: { message?: string; code?: string } };
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (reply.ok === true) pending.resolve(reply.result);
    else pending.reject(new NativeError(reply.error?.message || '桌面应用未能完成操作。',reply.error?.code || 'operation_failed'));
  }
  // 关闭时拒绝全部未完成请求，避免调用方停留在忙状态。
  dispose() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('编辑器已关闭。'));
    }
    this.pending.clear();
  }
}

declare global {
  interface Window { chrome?: { webview?: { postMessage: Send; addEventListener: (type: string, listener: (event: MessageEvent) => void) => void; removeEventListener: (type: string, listener: (event: MessageEvent) => void) => void } } }
}
const webview = typeof window === 'undefined' ? undefined : window.chrome?.webview;
export const native = new NativeBridge(webview ? message => webview.postMessage(message) : undefined);
// 主动捕获事件不属于某个请求，其图片仍由项目解析器校验。
export function subscribeNative(onImage: (image: unknown) => void, onPresentation?: (presentation: { presentation: 'workbench' | 'hidden'; reason?: string; timedOutCaptureId?: string; invalidatedCaptureId?: string | null }) => void) {
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (data?.event === 'image.loaded') onImage(data.payload);
    else if (data?.event === 'presentation.changed' && (data.payload?.presentation === 'workbench' || data.payload?.presentation === 'hidden')) onPresentation?.(data.payload);
    else native.receive(data);
  };
  webview?.addEventListener('message', receive);
  return () => webview?.removeEventListener('message', receive);
}
