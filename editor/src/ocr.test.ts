import { expect, it } from 'vitest';
import { parseOcr, correctBlock, reorderBlock, requestMatches } from './ocr';
const response = { modelVersion: 'test', imageWidth: 80, imageHeight: 60, blocks: [{ id: 'a', polygon: [{ x: 1, y: 2 }, { x: 70, y: 2 }, { x: 70, y: 20 }, { x: 1, y: 20 }], text: '<img src=x>', confidence: .9, order: 0 }, { id: 'b', polygon: [{ x: 1, y: 22 }, { x: 70, y: 22 }, { x: 70, y: 40 }, { x: 1, y: 40 }], text: 'second', confidence: null, order: 1 }] };
it('validates OCR geometry and retains original text when correcting and ordering', () => {
  const result = parseOcr(response, { crop: null, resize: null });
  const corrected = correctBlock(result, 'a', '修正');
  expect(corrected.blocks[0]).toMatchObject({ originalText: '<img src=x>', text: '修正' });
  expect(reorderBlock(corrected, 'b', -1).blocks.map(block => block.id)).toEqual(['b', 'a']);
  expect(() => parseOcr({ ...response, blocks: [response.blocks[0], response.blocks[0]] }, { crop: null, resize: null })).toThrow();
  expect(() => parseOcr({ ...response, blocks: [{ ...response.blocks[0], polygon: [{ x: 81, y: 1 }] }] }, { crop: null, resize: null })).toThrow();
});
it('rejects stale document, revision and request sequence independently', () => {
  const request = { documentId: 'a', generation: 2, revision: 3, sequence: 4 };
  expect(requestMatches(request, request)).toBe(true);
  for (const change of [{ documentId: 'b' }, { generation: 3 }, { revision: 4 }, { sequence: 5 }]) expect(requestMatches(request, { ...request, ...change })).toBe(false);
});
