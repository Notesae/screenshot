import { useRef, useState } from 'react';
import { applyEditorChange, type EditorState, type ProjectDocument } from './document';
import { commitHistory, createHistory, redoHistory, undoHistory, type HistoryState } from './history';

/** 引用先同步推进再通知 React，异步 AI 和捕获流程可读取准确的当前修订号。 */
export function useEditorHistory(initial: ProjectDocument) {
  const store = useRef(createHistory(initial));
  const [state, setState] = useState(store.current);
  const publish = (next: HistoryState) => { store.current = next; setState(next); };
  return {
    document: state.present, canUndo: Boolean(state.past.length), canRedo: Boolean(state.future.length), revision: state.revision,
    current: () => store.current.present, currentRevision: () => store.current.revision,
    reset(document: ProjectDocument) { publish({ ...createHistory(document), revision: store.current.revision + 1 }); },
    commitDocument(document: ProjectDocument, group?: string) { publish(commitHistory(store.current, document, { group })); },
    change(change: Partial<EditorState>, group?: string) { const current = store.current.present; publish(commitHistory(store.current, { ...current, editor: applyEditorChange(current.editor, change) }, { group })); },
    undo() { publish(undoHistory(store.current)); }, redo() { publish(redoHistory(store.current)); },
  };
}
