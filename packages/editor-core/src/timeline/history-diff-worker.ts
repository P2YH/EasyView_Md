import { computeGitDiff, computeHunkInlineHighlights } from '@easyview/markdown-core/git-diff';
self.onmessage = (event: MessageEvent<{ base: string; content: string }>) => {
  try {
  const hunks = computeGitDiff(event.data.base, event.data.content, { timeout: 2000, maxEditLength: 2000 }).hunks;
  const inline = hunks.map((hunk) => {
    if (hunk.oldLines.length * hunk.newLines.length > 4096 || [...hunk.oldLines, ...hunk.newLines].some((line) => line.length > 4096)) throw new Error('版本差异超出精细比较的计算预算，已停止计算');
    return computeHunkInlineHighlights(hunk.oldLines, hunk.newLines);
  });
  self.postMessage({ hunks, inline });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
