import { computeGitDiff, computeHunkInlineHighlights, GIT_DIFF_TOO_COMPLEX_MESSAGE } from '@easyview/markdown-core/git-diff';
class DiffBudgetExceededError extends Error {}
self.onmessage = (event: MessageEvent<{ base: string; content: string }>) => {
  try {
  const hunks = computeGitDiff(event.data.base, event.data.content, { timeout: 2000, maxEditLength: 2000 }).hunks;
  const inline = hunks.map((hunk) => {
    if (hunk.oldLines.length * hunk.newLines.length > 4096 || [...hunk.oldLines, ...hunk.newLines].some((line) => line.length > 4096)) throw new DiffBudgetExceededError('History diff exceeded the fine-grained comparison budget');
    return computeHunkInlineHighlights(hunk.oldLines, hunk.newLines);
  });
  self.postMessage({ hunks, inline });
  } catch (error) { self.postMessage({ error: error instanceof DiffBudgetExceededError || (error instanceof Error && error.message === GIT_DIFF_TOO_COMPLEX_MESSAGE) ? 'budgetExceeded' : 'failed', detail: error instanceof Error ? error.message : String(error) }); }
};
