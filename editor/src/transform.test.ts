import { describe, expect, it } from 'vitest';
import { contentGeometry, defaultEditor, outputSize, parseDocument, transformContent, type ProjectDocument } from './document';
const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: '原图.png', width: 800, height: 600 };
const doc: ProjectDocument = { schemaVersion: 2, image, editor: { ...defaultEditor(), annotations: [{ id: 'a', type: 'cover', left: 100, top: 80, width: 100, height: 50, scaleX: 1, scaleY: 1, angle: 0, text: '', color: '#123456', fontSize: 26 }] } };
describe('non-destructive crop and proportional resize', () => {
  it('crops source coordinates and transforms annotations while reusing the immutable image', () => {
    const crop = transformContent(doc, { x: 40, y: 20, width: 400, height: 300 }, null);
    expect(crop.image).toBe(image);
    expect(crop.editor.annotations[0]).toMatchObject({ left: 60, top: 60, scaleX: 1 });
    expect(outputSize(crop.image, crop.editor)).toEqual({ width: 400, height: 300 });
    const resized = transformContent(crop, crop.editor.crop, { width: 200, height: 150 });
    expect(resized.editor.annotations[0]).toMatchObject({ left: 30, top: 30, scaleX: .5, scaleY: .5 });
    expect(contentGeometry(image, resized.editor).crop.x).toBe(40);
    expect(transformContent(resized, null, null).editor.annotations[0]).toEqual(doc.editor.annotations[0]);
  });
  it('migrates v1, bounds v2 transforms and never accepts executable annotations', () => {
    expect(parseDocument({ ...doc, schemaVersion: 1 }).editor.crop).toBeNull();
    expect(parseDocument({ ...doc, schemaVersion: 1 }).schemaVersion).toBe(2);
    for (const change of [{ crop: { x: 700, y: 0, width: 200, height: 40 } }, { resize: { width: 200, height: 200 } }, { crop: { x: .5, y: 0, width: 100, height: 100 } }]) expect(() => parseDocument({ ...doc, editor: { ...doc.editor, ...change } })).toThrow();
    expect(() => parseDocument({ ...doc, editor: { ...doc.editor, annotations: [{ ...doc.editor.annotations[0], type: 'image', src: 'https://evil.test' }] } })).toThrow();
    const restored = parseDocument({ ...doc, editor: { ...doc.editor, annotations: [{ ...doc.editor.annotations[0], opacity: .1 }] } });
    expect(restored.editor.annotations[0]).not.toHaveProperty('opacity');
  });
});
