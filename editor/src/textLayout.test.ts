import { expect, it } from 'vitest';
import { defaultEditor } from './document';
import { textLayout } from './textLayout';
it('keeps complete long source and translation in parallel and stacked cards', () => {
  const editor = { ...defaultEditor(), text: '原文'.repeat(600), translation: 'translated '.repeat(300), textLayout: 'parallel' as const };
  for (const mode of ['parallel', 'stacked'] as const) {
    const layout = textLayout({ ...editor, textLayout: mode });
    expect(layout.sections.map(section => section.lines.join('')).join('')).toContain(editor.text);
    expect(layout.sections.map(section => section.lines.join('')).join('')).toContain(editor.translation);
    for (const section of layout.sections) expect(section.y + section.lines.length * layout.lineHeight).toBeLessThanOrEqual(layout.height - 32);
  }
});
