const graphemes = new Intl.Segmenter('en', { granularity:'grapheme' });
const wordCharacter = /^[\p{Script=Latin}\p{N}\p{M}'’_-]+$/u;

/** 英文等拉丁单词优先整体换行；超长词逐字素折行，不拆开组合字符或 emoji。 */
export function wrapParagraph(text: string, width: number, measure: (text: string) => number): string[] {
  const tokens: string[] = []; let word = '';
  for (const {segment} of graphemes.segment(text)) {
    if (wordCharacter.test(segment)) word += segment;
    else { if (word) { tokens.push(word); word = ''; } tokens.push(segment); }
  }
  if (word) tokens.push(word);
  const lines: string[] = []; let line = '';
  for (const token of tokens) {
    if (measure(line + token) <= width) { line += token; continue; }
    if (line) { lines.push(line); line = ''; }
    if (measure(token) <= width) { line = token; continue; }
    for (const {segment} of graphemes.segment(token)) {
      if (line && measure(line + segment) > width) { lines.push(line); line = ''; }
      line += segment;
    }
  }
  lines.push(line); return lines;
}
