import type { ProjectDocument } from './document';
export const SETTINGS_OPERATION = '打开设置';

/** 设置的模态窗口阻止用户继续编辑；后台任务和未提交的画布文字仍必须先结束。 */
export function prepareUpdateSnapshot(state: { operation: string; aiBusy: boolean; editing: boolean; loading: boolean; documentId: string; revision: number; document: ProjectDocument }) {
  if (state.aiBusy || (state.operation && state.operation !== SETTINGS_OPERATION)) return { error: '仍有编辑、识别或翻译任务，请等待完成或取消后再安装。' };
  if (state.editing) return { error: '请先结束画布文字编辑，再重新安装更新。' };
  if (state.loading) return { error: '画布尚未就绪，请等待完成后再安装。' };
  if (state.revision === 0 && !state.document.image && !state.document.editor.text && !state.document.editor.translation && !state.document.editor.annotations.length) return { empty: true };
  return { documentId: state.documentId, revision: state.revision, document: state.document };
}

declare global { interface Window { screenshotPrepareUpdate?: () => ReturnType<typeof prepareUpdateSnapshot> } }

// 钉图单独核对输出身份，收起后保留编辑文档，不冒用复制完成状态。
export type LeaveReason = 'replace' | 'close' | 'complete' | 'pin';
type LeaveState = Parameters<typeof prepareUpdateSnapshot>[0] & { projectSaved: boolean };
/** 离开前仅校验忙状态与内存身份；用户已关闭自动保存，不要求恢复快照。 */
export function prepareLeaveSnapshot(state: LeaveState, reason: LeaveReason) {
  const allowed = reason === 'replace' ? ['导入图片','读取文件','打开项目','恢复本机记录','捕获屏幕','捕获桌面','选择区域','粘贴图片']
    : reason === 'complete' ? ['完成截图'] : reason === 'pin' ? ['钉到桌面'] : ['退出编辑'];
  if (state.operation && !allowed.includes(state.operation)) return { error: `正在${state.operation}，请稍后再试。` };
  if (state.aiBusy && reason !== 'replace') return { error: '识别或翻译尚未结束，请等待完成或取消后再试。' };
  if (state.editing) return { error: '请先结束画布文字编辑，再继续此操作。' };
  if (state.loading) return { error: '画布尚未就绪，请稍后再试。' };
  const empty = !state.document.image && !state.document.editor.text && !state.document.editor.translation && !state.document.editor.annotations.length;
  return { documentId: state.documentId, revision: state.revision, document: state.document, empty, projectSaved: state.projectSaved };
}

declare global { interface Window {
  screenshotPrepareLeave?: (reason: LeaveReason) => ReturnType<typeof prepareLeaveSnapshot>;
  screenshotFinishLeave?: () => void;
  screenshotPresentCapture?: (captureId:string) => boolean;
} }
