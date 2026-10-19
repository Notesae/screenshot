import { describe, expect, it } from 'vitest';
import { annotationKeyAction, historyKeyAction, overlayKeyAction, type KeyContext } from './keyboard';
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
  it('routes document undo/redo without stealing IME or native text history', () => {
    const undo = { ...context, key: 'z', ctrl: true };
    expect(historyKeyAction(undo)).toBe('undo');
    expect(historyKeyAction({ ...undo, shift: true })).toBe('redo');
    expect(historyKeyAction({ ...undo, key: 'y' })).toBe('redo');
    for (const changed of [{ composing: true }, { textInput: true }, { fabricEditing: true }, { alt: true }]) expect(historyKeyAction({ ...undo, ...changed })).toBe('ignore');
  });
});

describe('annotation deletion', () => {
  it('deletes a selected object with Delete or Backspace', () => {
    for (const key of ['Delete','Backspace']) expect(annotationKeyAction({...context,key,selectedObject:true})).toBe('delete');
    expect(annotationKeyAction({...context,key:'Delete'})).toBe('ignore');
  });
  it('never deletes objects while typing, composing, editing Fabric text or using a modifier', () => {
    for(const change of [{textInput:true},{fabricEditing:true},{composing:true},{ctrl:true},{meta:true},{alt:true},{shift:true}]) expect(annotationKeyAction({...context,key:'Delete',selectedObject:true,...change})).toBe('ignore');
  });
});
