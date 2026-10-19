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
    const lines=wrapParagraph(text,4,count);expect(lines.join('')).toBe(text);expect(lines.every(line=>count(line.trimEnd())<=4)).toBe(true);
    if(text.includes('👨')) expect(lines.some(line=>line.includes('👨‍👩‍👧‍👦🇨🇳'))).toBe(true);
  }
});

it('keeps common closing punctuation off new lines and opening brackets off line ends',()=>{
  for(const text of ['甲乙丙，丁戊。','甲乙（丙丁）戊','甲乙「丙丁？！」','甲乙……丙丁','甲乙 《丙丁》']){
    const lines=wrapParagraph(text,4,count);expect(lines.join('')).toBe(text);
    expect(lines.slice(1).every(line=>!/[，。！？、；：）】》」』”’…]/u.test(line.trimStart()[0]||''))).toBe(true);
    const badEnd=lines.some(line=>/[（【《「『“‘]$/u.test(line.trimEnd()));expect(badEnd).toBe(false);
    expect(lines.every(line=>count(line.trimEnd())<=4)).toBe(true);
  }
});
it('preserves impossible narrow punctuation runs and exact spaces through bounded fallback',()=>{
  for(const text of ['甲，','（甲）','甲？！…','Hello, world!']){
    const lines=wrapParagraph(text,1,count);expect(lines.join('')).toBe(text);expect(lines.every(line=>count(line.trimEnd())<=1)).toBe(true);
  }
});
