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
