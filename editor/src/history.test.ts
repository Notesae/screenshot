import { describe, expect, it } from 'vitest';
import { createHistory, commitHistory, undoHistory, redoHistory } from './history';
import { defaultEditor, type ProjectDocument } from './document';
const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: '合成图.png', width: 80, height: 60 };
const original: ProjectDocument = { schemaVersion: 2, image, editor: defaultEditor() };
const changed = (text: string): ProjectDocument => ({ ...original, editor: { ...original.editor, text } });
describe('bounded document history', () => {
  it('把一次长滑杆手势合成一步，并把紧接的下一次手势分开', () => {
    let history = commitHistory(createHistory(original), changed('first'), { group: 'gesture:a', now: 10 });
    history = commitHistory(history, changed('last'), { group: 'gesture:a', now: 5010 });
    expect(history.past).toHaveLength(1); expect(history.revision).toBe(2);
    history = commitHistory(history, changed('next'), { group: 'gesture:b', now: 5020 });
    expect(history.past).toHaveLength(2);
    history = undoHistory(history); expect(history.present.editor.text).toBe('last');
    history = undoHistory(history); expect(history.present).toBe(original);
    expect(redoHistory(history).present.editor.text).toBe('last');
  });
  it('undoes complete state changes and redoes without cloning image data', () => {
    let history = createHistory(original);
    history = commitHistory(history, changed('识别结果'));
    expect(history.present.image).toBe(image);
    expect(history.past[0].image).toBe(image);
    history = undoHistory(history);
    expect(history.present).toBe(original);
    history = redoHistory(history);
    expect(history.present.editor.text).toBe('识别结果');
  });
  it('coalesces typing while keeping the original undo boundary and separates later edits', () => {
    let history = commitHistory(createHistory(original), changed('a'), { group: 'text', now: 10 });
    history = commitHistory(history, changed('ab'), { group: 'text', now: 200 });
    expect(history.past).toHaveLength(1);
    expect(undoHistory(history).present.editor.text).toBe('');
    history = commitHistory(history, changed('abc'), { group: 'text', now: 2000 });
    expect(history.past).toHaveLength(2);
  });
  it('clears redo after any new editing and ignores no-op changes', () => {
    let history = undoHistory(commitHistory(createHistory(original), changed('old')));
    history = commitHistory(history, changed('new'));
    expect(history.future).toHaveLength(0);
    expect(commitHistory(history, { ...history.present, editor: { ...history.present.editor } })).toBe(history);
  });
  it('limits entry count and editor metadata memory while sharing one source image', () => {
    let history = createHistory(original);
    for (let index = 0; index < 150; index++) history = commitHistory(history, changed(String(index)), { now: index * 1000 });
    expect(history.past.length).toBeLessThanOrEqual(80);
    expect(history.past.every(doc => doc.image === image)).toBe(true);
    expect(createHistory(changed('new source')).past).toHaveLength(0);
    const large = { ...original, editor: { ...original.editor, annotations: Array.from({ length: 100 }, (_, index) => ({ id: `a-${index}`, type: 'text' as const, left: 0, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0, text: '字'.repeat(5000), color: '#123456', fontSize: 26 })) } };
    history = createHistory(large);
    for (let index = 0; index < 20; index++) history = commitHistory(history, { ...large, editor: { ...large.editor, title: String(index) } });
    expect(history.past.length).toBeLessThan(10);
  });
});
