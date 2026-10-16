/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { closeOpenFence, renderStreamingMarkdown } from './aiChatMarkdown';

describe('streaming AI chat markdown', () => {
  it('closes an unterminated code fence so partial code renders as code', () => {
    expect(closeOpenFence('Intro\n```ts\nconst a = 1')).toBe('Intro\n```ts\nconst a = 1\n```');
    expect(closeOpenFence('```\ndone\n```\nafter')).toBe('```\ndone\n```\nafter');
    expect(renderStreamingMarkdown('**bold** and\n```js\nlet x')).toContain('<pre><code class="language-js">let x');
    expect(renderStreamingMarkdown('**bold** and')).toContain('<strong>bold</strong>');
  });
  it('renders partial lists and never passes raw HTML through', () => {
    expect(renderStreamingMarkdown('- one\n- tw')).toContain('<li>tw</li>');
    const html = renderStreamingMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toContain('<img'); expect(html).not.toContain('href="javascript:');
  });
});
