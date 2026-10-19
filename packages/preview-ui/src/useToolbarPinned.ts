import * as React from 'react';
import { readToolbarPinned, subscribeToolbarVisibility, writeToolbarPinned } from './toolbarState';

export function useToolbarPinned(): {
  pinnedOpen: boolean;
  togglePinned(event: React.MouseEvent<HTMLButtonElement>): void;
} {
  const pinnedOpen = React.useSyncExternalStore(subscribeToolbarVisibility, readToolbarPinned, readToolbarPinned);
  const togglePinned = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    writeToolbarPinned(!readToolbarPinned());
  }, []);
  return { pinnedOpen, togglePinned };
}
