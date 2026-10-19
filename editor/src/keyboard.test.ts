import { describe, expect, it } from 'vitest';
import { overlayKeyAction, type KeyContext } from './keyboard';
const context: KeyContext = { key: 'Escape', ctrl: false, meta: false, alt: false, shift: false, composing: false, textInput: false, fabricEditing: false, selectedObject: false, panelOpen: false, textSelection: false };
describe('overlay keyboard decisions', () => {
  it('does not dismiss while composing or editing input text', () => {
    expect(overlayKeyAction({ ...context, composing: true })).toBe('ignore');
    expect(overlayKeyAction({ ...context, textInput: true })).toBe('ignore');
  });
  it('exits Fabric editing, closes panels, then deselects objects before dismissal', () => {
    expect(overlayKeyAction({ ...context, fabricEditing: true, panelOpen: true })).toBe('exit-object');
    expect(overlayKeyAction({ ...context, panelOpen: true, selectedObject: true })).toBe('close-panel');
    expect(overlayKeyAction({ ...context, selectedObject: true })).toBe('exit-object');
    expect(overlayKeyAction(context)).toBe('dismiss');
  });
  it('copies images only when Ctrl+C is outside editable or selected text', () => {
    const copy = { ...context, key: 'c', ctrl: true };
    expect(overlayKeyAction(copy)).toBe('copy-image');
    for (const changed of [{ textInput: true }, { fabricEditing: true }, { textSelection: true }, { composing: true }, { alt: true }, { shift: true }]) expect(overlayKeyAction({ ...copy, ...changed })).toBe('ignore');
  });
});
