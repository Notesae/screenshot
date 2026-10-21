import type { EditorState } from './document';

/** 只跟踪当前模式真正参与底图的字段；不可见校对内容仍进入历史/保存，但不重建大图。 */
export function baseRenderKey(editor: EditorState): string {
  if (editor.mode === 'raw') return JSON.stringify([editor.mode, editor.crop, editor.resize, editor.imageTranslation]);
  if (editor.mode === 'beauty') return JSON.stringify([editor.mode, editor.crop, editor.resize, editor.padding, editor.radius, editor.background, editor.shadow, editor.borderWidth, editor.borderColor, editor.imageTranslation]);
  const layout = editor.textLayout || 'source';
  return JSON.stringify([editor.mode, layout, editor.title, editor.fontSize, editor.textWidth, editor.lineSpacing, editor.paragraphSpacing,
    layout === 'translated' ? null : editor.text, layout === 'source' ? null : editor.translation]);
}
