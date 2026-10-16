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

/**
 * Renders a partial (still streaming) reply. An unterminated code fence is closed so the code
 * block renders as code instead of swallowing the text as a paragraph; everything else in
 * markdown-it already degrades gracefully on incomplete input. Raw HTML stays disabled.
 */
export function renderStreamingMarkdown(text: string): string {
  return markdown.render(closeOpenFence(text));
}

export function closeOpenFence(text: string): string {
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1];
    if (fence === null) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
  }
  return fence === null ? text : `${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
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
