import tokens from '../../design/soft-clay.tokens.json';

/** WPF 与网页读取同一份 token；CSS 变量在挂载前写入，不引入生成文件或网络资源。 */
export function applySoftClayTokens() {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(tokens.colors)) root.setProperty(`--clay-${name}`, value);
  for (const [name, value] of Object.entries(tokens.radius)) root.setProperty(`--clay-radius-${name}`, `${value}px`);
  for (const [name, value] of Object.entries(tokens.size)) root.setProperty(`--clay-size-${name}`, `${value}px`);
  for (const name of ['press', 'release', 'card', 'close', 'exit', 'toast'] as const) root.setProperty(`--clay-time-${name}`, `${tokens.motion[name]}ms`);
  root.setProperty('--clay-spring', `cubic-bezier(${tokens.motion.spring.join(',')})`);
  root.setProperty('--clay-pressed-scale', String(tokens.motion.pressedScale));
  root.setProperty('--clay-font', tokens.font);
  root.setProperty('--clay-highlight', tokens.shadow.highlight);
  root.setProperty('--clay-shade', tokens.shadow.shade);
  root.setProperty('--clay-shadow', `0 ${tokens.shadow.depth}px ${tokens.shadow.blur}px rgb(0 0 0 / ${tokens.shadow.opacity})`);
}
