/** Word outline chrome prefs (minimap pin + left/right). Separate from Markdown panelDock. */

export type WordOutlineSide = 'left' | 'right';

export const WORD_OUTLINE_PINNED_KEY = 'easyview.wordOutlinePinned';
export const WORD_OUTLINE_SIDE_KEY = 'easyview.wordOutlineSide';

/** Default unpinned so Word opens with the pulse/minimap rail, matching Markdown. */
export function readWordOutlinePinned(): boolean {
  try {
    const raw = localStorage.getItem(WORD_OUTLINE_PINNED_KEY);
    if (raw === null) return false;
    return raw === '1';
  } catch {
    return false;
  }
}

export function writeWordOutlinePinned(pinned: boolean): void {
  try {
    localStorage.setItem(WORD_OUTLINE_PINNED_KEY, pinned ? '1' : '0');
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function readWordOutlineSide(): WordOutlineSide {
  try {
    return localStorage.getItem(WORD_OUTLINE_SIDE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

export function writeWordOutlineSide(side: WordOutlineSide): void {
  try {
    localStorage.setItem(WORD_OUTLINE_SIDE_KEY, side);
  } catch {
    // Ignore quota / private-mode failures.
  }
}
