const graphemes = new Intl.Segmenter('en', { granularity:'grapheme' });
// 常用行首/行尾禁则，参考W3C CLREQ 6.1.1；不宣称完整排版标准实现。
const noStart = new Set([...",.!?:;，。！？：；、％‰）］｝】〕〉》」』”’…—"]);
const noEnd = new Set([..."([{（［｛【〔〈《「『“‘"]);
const wordCharacter = /^[\p{Script=Latin}\p{N}\p{M}'’_-]+$/u;

/** 英文等拉丁单词优先整体换行；超长词逐字素折行，不拆开组合字符或 emoji。 */
export function wrapParagraph(text: string, width: number, measure: (text: string) => number): string[] {
  const tokens: string[] = []; let word = '';
  for (const {segment} of graphemes.segment(text)) {
    if (wordCharacter.test(segment)) word += segment;
    else { if (word) { tokens.push(word); word = ''; } tokens.push(segment); }
  }
  if (word) tokens.push(word);
  const units:string[]=[];
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],previous=units.at(-1),last=previous?.trimEnd().slice(-1);
    const beforeClosing=/^\s+$/.test(token)&&noStart.has(tokens[i+1]?.[0]);
    if(previous!==undefined&&(noEnd.has(last!)||noStart.has(token[0])||beforeClosing))units[units.length-1]+=token;
    else units.push(token);
  }
  const lines: string[] = []; let line = '';
  for (const token of units) {
    if (measure(line + token) <= width) { line += token; continue; }
    if(line&&!line.trim()&&lines.length){lines[lines.length-1]+=line;line='';}
    if (line) { lines.push(line); line = ''; }
    if (measure(token) <= width) { line = token; continue; }
    // 组合本身比栏宽更宽时按字素退化，保留全部内容，不越界挤压或自动缩字。
    for (const {segment} of graphemes.segment(token)) {
      if (line && measure(line + segment) > width) { lines.push(line); line = ''; }
      line += segment;
    }
  }
  lines.push(line); return lines;
}
