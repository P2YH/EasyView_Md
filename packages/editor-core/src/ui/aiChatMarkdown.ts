/**
 * Markdown rendering for AI chat messages plus extraction of the fenced
 * document block emitted by the model in agent mode.
 */

import MarkdownIt from 'markdown-it';
import { StreamingTailDom } from './StreamingTailDom';
import { IncrementalMarkdown } from './IncrementalMarkdown';
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
 * Reference full renderer for partial replies. markdown-it handles open fences
 * without inserting synthetic text, which also preserves nested-fence semantics.
 */
export function renderStreamingMarkdown(text: string): string {
  return markdown.render(text);
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

/** Each bubble owns a parser and stable DOM prefix; completed nodes retain identity. */
export function createStreamingMarkdownRenderer() {
  const parser = new IncrementalMarkdown(markdown);
  let mounted: HTMLElement | undefined;
  let count = 0;
  let length = 0;
  let stableBlocks: ReturnType<IncrementalMarkdown['update']>['stable'] | undefined;
  const mountedBlocks: Array<{ element: HTMLElement; html: string }> = [];
  const tail = document.createElement('div');
  tail.style.display = 'contents';
  let tailDom: StreamingTailDom | undefined;
  let plainTail: string | undefined;
  return {
    render(container: HTMLElement, text: string, decorate: (node: HTMLElement) => void, final = false, appendOnly = false) {
      const result = appendOnly && text.length >= length ? parser.append(text.slice(length), final) : parser.update(text, final);
      length = text.length;
      if (mounted !== container || stableBlocks !== result.stable) {
        container.replaceChildren(); count = 0; mountedBlocks.length = 0; mounted = container; stableBlocks = result.stable;
      }
      if (result.invalidated) for (let i = 0; i < count; i++) {
        const cached = mountedBlocks[i], html = result.stable[i].html;
        if (cached.html === html) continue;
        parser.metrics.domCharacters += html.length;
        cached.element.innerHTML = html; decorate(cached.element); cached.html = html;
      }
      for (; count < result.stable.length; count++) {
        const block = document.createElement('div'); block.style.display = 'contents';
        parser.metrics.domCharacters += result.stable[count].html.length;
        block.innerHTML = result.stable[count].html; decorate(block); container.append(block);
        mountedBlocks.push({ element: block, html: result.stable[count].html });
      }
      if (result.tailView) {
        if (!tailDom) tailDom = new StreamingTailDom(tail, decorate, parser.metrics);
        tailDom.render(result.tailView); plainTail = undefined;
      } else {
        tailDom = undefined;
        if (plainTail !== result.tail) { tail.innerHTML = result.tail; parser.metrics.domCharacters += result.tail.length; decorate(tail); plainTail = result.tail; }
      }
      if (tail.parentElement !== container || container.lastChild !== tail) container.append(tail);
    },
    metrics: parser.metrics,
  };
}
