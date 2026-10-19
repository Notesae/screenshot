/** 合并单换行，保留段落分隔；汉字相邻不插入空格，拉丁文字保留词边界。 */
export function copyText(text: string, mergeLines: boolean) {
  if (!mergeLines) return text;
  return text.replace(/\r\n?/g,'\n').split(/\n{2,}/).map(paragraph=>paragraph.split('\n').reduce((joined,line)=>{
    const next = line.trim();
    if (!joined) return next;
    const cjk = /[\p{Script=Han}，。！？、；：）】]$/u.test(joined) && /^[\p{Script=Han}，。！？、；：]/u.test(next);
    return joined.trimEnd() + (cjk ? '' : ' ') + next;
  },'')).join('\n\n');
}
