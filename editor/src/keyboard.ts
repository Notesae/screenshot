/** 将按键与编辑上下文转换为意图，纯函数便于在不操作桌面的情况下验证。 */
export type KeyContext = { key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; composing: boolean; textInput: boolean; fabricEditing: boolean; selectedObject: boolean; panelOpen: boolean; textSelection: boolean };
export type OverlayKeyAction = 'ignore' | 'copy-image' | 'close-panel' | 'exit-object' | 'dismiss';
/** 输入框和 Fabric 文字保留原生文本撤销；其余上下文才路由到整份文档历史。 */
export function historyKeyAction(context: KeyContext): 'undo' | 'redo' | 'ignore' {
  if (context.composing || context.textInput || context.fabricEditing || context.alt || !(context.ctrl || context.meta)) return 'ignore';
  if (context.key.toLowerCase() === 'z') return context.shift ? 'redo' : 'undo';
  return context.key.toLowerCase() === 'y' && !context.shift ? 'redo' : 'ignore';
}

export function overlayKeyAction(context: KeyContext): OverlayKeyAction {
  if (context.composing) return 'ignore';
  if (context.key === 'Escape') {
    if (context.fabricEditing) return 'exit-object';
    if (context.textInput) return 'ignore';
    if (context.panelOpen) return 'close-panel';
    return context.selectedObject ? 'exit-object' : 'dismiss';
  }
  if (context.key.toLowerCase() === 'c' && (context.ctrl || context.meta) && !context.alt && !context.shift && !context.textInput && !context.fabricEditing && !context.textSelection) return 'copy-image';
  return 'ignore';
}

/** Delete is a document action only outside all text-editing contexts. */
export function annotationKeyAction(context: KeyContext): 'delete' | 'ignore' {
  return !context.composing && !context.textInput && !context.fabricEditing && !context.ctrl && !context.meta && !context.alt && !context.shift && context.selectedObject && ['Delete', 'Backspace'].includes(context.key) ? 'delete' : 'ignore';
}
