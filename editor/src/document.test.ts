import { describe, it, expect } from 'vitest';
import { parseDocument, defaultEditor, outputSize, applyEditorChange, type Annotation } from './document';

const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'test.png', width: 80, height: 60 };
describe('project trust boundary', () => {
  it('round-trips explicit local document fields', () => {
    expect(parseDocument({ schemaVersion: 1, image, editor: defaultEditor() }).image).toEqual(image);
  });
  it('rejects remote images and unsupported versions', () => {
    expect(() => parseDocument({ schemaVersion: 2, image, editor: defaultEditor() })).toThrow();
    expect(() => parseDocument({ schemaVersion: 1, image: { ...image, dataUrl: 'https://example.com/a.png' }, editor: defaultEditor() })).toThrow();
  });
  it('rejects oversized dimensions, invalid controls and executable objects', () => {
    for (const change of [{ padding: -1 }, { radius: 1000 }, { background: 'url(https://evil.test)' }, { annotations: [{ type: 'image', src: 'https://evil.test' }] }]) {
      expect(() => parseDocument({ schemaVersion: 1, image, editor: { ...defaultEditor(), ...change } })).toThrow();
    }
    expect(() => parseDocument({ schemaVersion: 1, image: { ...image, width: 100000 }, editor: defaultEditor() })).toThrow();
  });
});
describe('output geometry', () => {
  it('keeps raw image pixels and adds padding only in beauty mode', () => {
    expect(outputSize(image, defaultEditor())).toEqual({ width: 80, height: 60 });
    expect(outputSize(image, { ...defaultEditor(), mode: 'beauty', padding: 32 })).toEqual({ width: 144, height: 124 });
  });
  it('constrains text output and rejects unsafe export allocation', () => {
    expect(outputSize(null, { ...defaultEditor(), mode: 'reflow', text: '文字' }).width).toBe(720);
    expect(() => outputSize({ ...image, width: 16000, height: 16000 }, defaultEditor(), 2)).toThrow();
  });
});
describe('annotation content anchoring', () => {
  it('moves annotations with effective padding and never double-moves explicit object callbacks', () => {
    const annotation: Annotation = { type: 'rect', left: 10, top: 20, width: 100, height: 50, scaleX: 1, scaleY: 1, angle: 0, text: '', color: '#b4432c', fontSize: 26 };
    const raw = { ...defaultEditor(), annotations: [annotation] };
    const beauty = applyEditorChange(raw, { mode: 'beauty' });
    expect(beauty.annotations[0]).toMatchObject({ left: 58, top: 68 });
    const padded = applyEditorChange(beauty, { padding: 80 });
    expect(padded.annotations[0]).toMatchObject({ left: 90, top: 100 });
    expect(applyEditorChange(padded, { mode: 'raw' }).annotations[0]).toEqual(annotation);
    expect(applyEditorChange(raw, { padding: 80 }).annotations).toBe(raw.annotations);
    expect(applyEditorChange(beauty, { padding: 48 }).annotations).toBe(beauty.annotations);
    const moved = [{ ...beauty.annotations[0], left: 66 }];
    expect(applyEditorChange(beauty, { annotations: moved }).annotations).toBe(moved);
    expect(applyEditorChange(beauty, { mode: 'raw', annotations: moved }).annotations).toBe(moved);
    const reflow = applyEditorChange(beauty, { mode: 'reflow' });
    expect(reflow.annotations).toBe(beauty.annotations);
    expect(applyEditorChange(reflow, { mode: 'beauty', padding: 120 }).annotations).toBe(reflow.annotations);
    expect(annotation).toMatchObject({ left: 10, top: 20 });
  });
});
