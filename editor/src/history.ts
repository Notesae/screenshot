import type { ProjectDocument } from './document';
/** 只保留文档引用和编辑元数据；源图片对象在每个快照间共享，不复制 Base64。 */
export type HistoryState = { past: ProjectDocument[]; present: ProjectDocument; future: ProjectDocument[]; revision: number; group?: string; time: number };
export function createHistory(document: ProjectDocument): HistoryState { return { past: [], present: document, future: [], revision: 0, time: 0 }; }
function metadata(document: ProjectDocument) { return JSON.stringify(document.editor); }
/** 合并相邻输入事务，限制最多80步与8MiB元数据；新编辑始终丢弃重做分支。 */
export function commitHistory(state: HistoryState, document: ProjectDocument, options: { group?: string; now?: number } = {}): HistoryState {
  if (state.present.image === document.image && metadata(state.present) === metadata(document)) return state;
  // 手势组每次按下生成独立 ID，中途停顿也不能把一次滑杆操作拆成多次撤销。
  const now = options.now ?? Date.now(), merge = Boolean(options.group && state.group === options.group && (options.group.startsWith('gesture:') || now - state.time < 800) && !state.future.length);
  let past = merge ? state.past : [...state.past, state.present];
  let bytes = metadata(document).length * 2;
  for (let index = past.length - 1; index >= 0; index--) {
    bytes += metadata(past[index]).length * 2;
    if (past.length - index > 80 || bytes > 8 * 1024 * 1024) { past = past.slice(index + 1); break; }
  }
  return { past, present: document, future: [], revision: state.revision + 1, group: options.group, time: now };
}
export function undoHistory(state: HistoryState): HistoryState {
  if (!state.past.length) return state;
  return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future], revision: state.revision + 1, time: 0 };
}
export function redoHistory(state: HistoryState): HistoryState {
  if (!state.future.length) return state;
  return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1), revision: state.revision + 1, time: 0 };
}
