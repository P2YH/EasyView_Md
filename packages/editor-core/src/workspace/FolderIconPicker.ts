/**
 * FolderIconPicker - Modal dialog for selecting custom folder icons
 */

import type { FolderIconTheme, FolderIconVariant } from '@easyview/contracts';
import { getAllFolderIconThemes, getAllFolderIconVariants, getFolderIconDefinition } from '@easyview/contracts';

interface FolderIconPickerOptions {
  onSelect: (theme: FolderIconTheme, variant: FolderIconVariant) => void;
  onReset: () => void;
  onClose: () => void;
  title: string;
  resetLabel: string;
  tabLabels: Record<FolderIconTheme, string>;
}

export function openFolderIconPicker(options: FolderIconPickerOptions): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'folder-icon-picker-overlay';
  
  const dialog = document.createElement('div');
  dialog.className = 'folder-icon-picker-dialog';
  
  const header = document.createElement('div');
  header.className = 'folder-icon-picker-header';
  
  const title = document.createElement('h2');
  title.className = 'folder-icon-picker-title';
  title.textContent = options.title;
  
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'folder-icon-picker-close';
  closeButton.innerHTML = '×';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.addEventListener('click', () => {
    options.onClose();
    cleanup();
  });
  
  header.append(title, closeButton);
  
  const tabs = document.createElement('div');
  tabs.className = 'folder-icon-picker-tabs';
  
  const content = document.createElement('div');
  content.className = 'folder-icon-picker-content';
  
  const themes = getAllFolderIconThemes();
  let activeTheme: FolderIconTheme = themes[0];
  
  const renderContent = () => {
    content.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'folder-icon-picker-grid';
    
    const variants = getAllFolderIconVariants();
    for (const variant of variants) {
      const icon = getFolderIconDefinition(activeTheme, variant);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'folder-icon-picker-tile';
      tile.innerHTML = icon.svg;
      tile.title = variant.charAt(0).toUpperCase() + variant.slice(1);
      tile.addEventListener('click', () => {
        options.onSelect(activeTheme, variant);
        cleanup();
      });
      grid.appendChild(tile);
    }
    
    content.appendChild(grid);
  };
  
  for (const theme of themes) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'folder-icon-picker-tab';
    tab.textContent = options.tabLabels[theme];
    tab.dataset.theme = theme;
    
    if (theme === activeTheme) {
      tab.classList.add('active');
    }
    
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.folder-icon-picker-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeTheme = theme;
      renderContent();
    });
    
    tabs.appendChild(tab);
  }
  
  const footer = document.createElement('div');
  footer.className = 'folder-icon-picker-footer';
  
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'folder-icon-picker-reset';
  resetButton.textContent = options.resetLabel;
  resetButton.addEventListener('click', () => {
    options.onReset();
    cleanup();
  });
  
  footer.appendChild(resetButton);
  
  dialog.append(header, tabs, content, footer);
  overlay.appendChild(dialog);
  
  renderContent();
  
  document.body.appendChild(overlay);
  
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      options.onClose();
      cleanup();
    }
  };
  
  const handleOverlayClick = (event: MouseEvent) => {
    if (event.target === overlay) {
      options.onClose();
      cleanup();
    }
  };
  
  document.addEventListener('keydown', handleEscape);
  overlay.addEventListener('click', handleOverlayClick);
  
  const cleanup = () => {
    document.removeEventListener('keydown', handleEscape);
    overlay.removeEventListener('click', handleOverlayClick);
    overlay.remove();
  };
  
  return cleanup;
}
