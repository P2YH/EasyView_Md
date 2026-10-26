/**
 * FolderIconPicker - Modal dialog for selecting custom folder icons
 */

import type { FolderIconTheme, FolderIconVariant } from '@easyview/contracts';
import {
  getAllFolderIconThemes,
  getFolderIconDefinition,
  getFolderIconVariantsForTheme,
  isDefaultFolderIconTheme,
} from '@easyview/contracts';

export type FolderIconPickerLayout = 'tabs' | 'sections';

export interface FolderIconPickerSelection {
  theme: FolderIconTheme;
  variant: FolderIconVariant;
}

interface FolderIconPickerOptions {
  onSelect: (theme: FolderIconTheme, variant: FolderIconVariant) => void;
  onReset: () => void;
  onClose: () => void;
  title: string;
  resetLabel: string;
  tabLabels: Record<FolderIconTheme, string>;
  /** tabs = horizontal theme tabs (desktop); sections = stacked theme groups (extension sidebar). */
  layout?: FolderIconPickerLayout;
  /**
   * Currently applied custom icon. When null/undefined the folder still uses the
   * built-in default beige folder — the Default group is shown as selected.
   */
  selected?: FolderIconPickerSelection | null;
}

function resolveSelection(selected: FolderIconPickerSelection | null | undefined): FolderIconPickerSelection {
  if (selected && !isDefaultFolderIconTheme(selected.theme)) {
    return selected;
  }
  return { theme: 'default', variant: 'plain' };
}

function createTile(
  theme: FolderIconTheme,
  variant: FolderIconVariant,
  isSelected: boolean,
  onSelect: (theme: FolderIconTheme, variant: FolderIconVariant) => void,
  cleanup: () => void,
): HTMLButtonElement {
  const icon = getFolderIconDefinition(theme, variant);
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'folder-icon-picker-tile';
  if (isSelected) tile.classList.add('selected');
  tile.setAttribute('aria-pressed', String(isSelected));
  tile.innerHTML = icon.svg;
  tile.title = variant.charAt(0).toUpperCase() + variant.slice(1);
  tile.dataset.theme = theme;
  tile.dataset.variant = variant;
  tile.addEventListener('click', () => {
    onSelect(theme, variant);
    cleanup();
  });
  return tile;
}

function appendThemeGrid(
  parent: HTMLElement,
  theme: FolderIconTheme,
  current: FolderIconPickerSelection,
  onSelect: (theme: FolderIconTheme, variant: FolderIconVariant) => void,
  cleanup: () => void,
): void {
  const grid = document.createElement('div');
  grid.className = 'folder-icon-picker-grid';
  for (const variant of getFolderIconVariantsForTheme(theme)) {
    const isSelected = current.theme === theme && current.variant === variant;
    grid.appendChild(createTile(theme, variant, isSelected, onSelect, cleanup));
  }
  parent.appendChild(grid);
}

export function openFolderIconPicker(options: FolderIconPickerOptions): () => void {
  const layout: FolderIconPickerLayout = options.layout ?? 'tabs';
  const themes = getAllFolderIconThemes();
  const current = resolveSelection(options.selected);

  const overlay = document.createElement('div');
  overlay.className = 'folder-icon-picker-overlay';
  overlay.dataset.layout = layout;

  const dialog = document.createElement('div');
  dialog.className = 'folder-icon-picker-dialog';
  dialog.dataset.layout = layout;

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

  const content = document.createElement('div');
  content.className = 'folder-icon-picker-content';

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

  let cleanup = () => {
    document.removeEventListener('keydown', handleEscape);
    overlay.removeEventListener('click', handleOverlayClick);
    overlay.remove();
  };

  if (layout === 'sections') {
    for (const theme of themes) {
      const section = document.createElement('section');
      section.className = 'folder-icon-picker-section';
      section.dataset.theme = theme;
      if (theme === current.theme) section.classList.add('is-current');

      const heading = document.createElement('h3');
      heading.className = 'folder-icon-picker-section-title';
      heading.textContent = options.tabLabels[theme];

      section.appendChild(heading);
      appendThemeGrid(section, theme, current, options.onSelect, () => cleanup());
      content.appendChild(section);
    }
    dialog.append(header, content, footer);
  } else {
    const tabs = document.createElement('div');
    tabs.className = 'folder-icon-picker-tabs';
    let activeTheme: FolderIconTheme = themes.includes(current.theme) ? current.theme : themes[0]!;

    const renderContent = () => {
      content.innerHTML = '';
      appendThemeGrid(content, activeTheme, current, options.onSelect, () => cleanup());
    };

    for (const theme of themes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'folder-icon-picker-tab';
      tab.textContent = options.tabLabels[theme];
      tab.dataset.theme = theme;
      if (theme === activeTheme) tab.classList.add('active');
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.folder-icon-picker-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        activeTheme = theme;
        renderContent();
      });
      tabs.appendChild(tab);
    }

    dialog.append(header, tabs, content, footer);
    renderContent();
  }

  overlay.appendChild(dialog);
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

  cleanup = () => {
    document.removeEventListener('keydown', handleEscape);
    overlay.removeEventListener('click', handleOverlayClick);
    overlay.remove();
  };

  // In sections layout, bring the currently selected theme into view.
  if (layout === 'sections') {
    requestAnimationFrame(() => {
      const currentSection = content.querySelector('.folder-icon-picker-section.is-current');
      currentSection?.scrollIntoView({ block: 'nearest' });
    });
  }

  return cleanup;
}
