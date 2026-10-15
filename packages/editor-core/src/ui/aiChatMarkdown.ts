/**
 * Markdown rendering for AI chat messages plus extraction of the fenced
 * document block emitted by the model in agent mode.
 */

import MarkdownIt from 'markdown-it';
import { tAiChat } from './aiChat.i18n';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 48) || 'h';
}

/** Renders assistant markdown into sanitized HTML (raw HTML disabled). */
export function renderAssistantMarkdown(text: string): string {
  return markdown.render(text);
}

/** Adds a heading id so in-panel anchor links work. Called post-render. */
export function decorateRenderedMarkdown(container: HTMLElement, onCopyCode: (code: string) => void): void {
  for (const heading of container.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    heading.id = `ai-chat-${slugify(heading.textContent ?? '')}`;
  }
  for (const block of container.querySelectorAll('pre > code')) {
    const pre = block.parentElement as HTMLPreElement;
    if (pre.querySelector('.ai-chat-code-copy')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-chat-code-copy';
    button.textContent = tAiChat('code.copy');
    button.addEventListener('click', () => {
      onCopyCode(block.textContent ?? '');
      button.textContent = tAiChat('code.copied');
      window.setTimeout(() => {
        button.textContent = tAiChat('code.copy');
      }, 1500);
    });
    pre.appendChild(button);
  }
}
