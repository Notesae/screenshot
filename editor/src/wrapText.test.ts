import { expect, it } from 'vitest';
import { wrapParagraph } from './wrapText';
const count = (text:string) => [...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(text)].length;
it('wraps fitting Latin words together and preserves the exact paragraph content', () => {
  const text='Clear hierarchy keeps long content readable.';
  const lines=wrapParagraph(text,16,count);
  expect(lines.join('')).toBe(text);
  for(const word of text.match(/[A-Za-z]+/g)!) expect(lines.some(line=>line.includes(word))).toBe(true);
  expect(lines.every(line=>count(line)<=16)).toBe(true);
});
it('preserves CJK, emoji graphemes, combining letters, blank paragraphs and long words', () => {
  for(const text of ['中文标点，逐字换行。','A👨‍👩‍👧‍👦🇨🇳B','café déjà-vu', 'Supercalifragilisticexpialidocious','    保留缩进','']) {
    const lines=wrapParagraph(text,4,count);expect(lines.join('')).toBe(text);expect(lines.every(line=>count(line)<=4)).toBe(true);
    if(text.includes('👨')) expect(lines.some(line=>line.includes('👨‍👩‍👧‍👦🇨🇳'))).toBe(true);
  }
});
