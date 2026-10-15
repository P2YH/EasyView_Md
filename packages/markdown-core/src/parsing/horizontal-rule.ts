const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING_RE = /^ {0,3}#{1,6}(\s|$)/;

/**
 * Line indexes that CommonMark renders as a thematic break (`---`, `***`, `___`).
 * Skips front matter delimiters, fenced code, and `---` under a paragraph line
 * (that is a setext H2 underline, not a rule).
 */
export function findHorizontalRuleLines(lines: readonly string[]): number[] {
  const result: number[] = [];
  let fence: string | null = null;
  let start = 0;

  const opening = lines[0]?.trim() === '---' ? 0 : /^<!--.*-->\s*$/.test(lines[0] ?? '') && lines[1]?.trim() === '---' ? 1 : -1;
  if (opening >= 0) {
    const closing = lines.findIndex((line, index) => index > opening && /^(-{3}|\.{3})\s*$/.test(line));
    if (closing > opening) start = closing + 1;
  }

  let paragraphOpen = false;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      paragraphOpen = false;
      continue;
    }

    const match = THEMATIC_BREAK_RE.exec(line);
    if (match && !(match[1] === '-' && paragraphOpen)) {
      result.push(index);
      paragraphOpen = false;
      continue;
    }
    paragraphOpen = !match && line.trim() !== '' && !ATX_HEADING_RE.test(line);
  }
  return result;
}
