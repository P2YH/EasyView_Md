/**
 * Custom folder icon definitions for workspace tree customization.
 * Provides 10 theme tabs with various icon styles and functional variants.
 */

export type FolderIconTheme =
  | 'outline'
  | 'filled-line'
  | 'flat'
  | 'glyph'
  | 'gradient'
  | 'macos'
  | 'windows'
  | 'christmas'
  | 'lunar'
  | 'valentine';

export type FolderIconVariant =
  | 'plain'
  | 'lock'
  | 'cloud'
  | 'music'
  | 'code'
  | 'clock'
  | 'star'
  | 'search'
  | 'plus'
  | 'check'
  | 'list'
  | 'gift'
  | 'tree'
  | 'bell';

export interface FolderIconDefinition {
  theme: FolderIconTheme;
  variant: FolderIconVariant;
  svg: string;
  color?: string;
}

/**
 * Outline theme - clean geometric line icons
 */
const OUTLINE_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13.5" r="2.5"/><path d="M12 11.5v2l1.5 1"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="11" cy="13" r="2"/><path d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

/**
 * Filled Line theme - folders with solid fill and outlined symbols
 */
const FILLED_LINE_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect fill="currentColor" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="currentColor" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="currentColor" cx="12" cy="13.5" r="2.5"/><path fill="currentColor" d="M12 11.5v2l1.5 1"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="currentColor" cx="11" cy="13" r="2"/><path fill="currentColor" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="currentColor" opacity="0.3" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

/**
 * Flat theme - solid color folders with simple symbols
 */
const FLAT_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="#90CAF9" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="#90CAF9" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect fill="#fff" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#fff" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="#90CAF9" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="#CE93D8" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="#81C784" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="#FFB74D" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="#fff" cx="12" cy="13.5" r="2.5"/><path fill="#333" d="M12 11.5v2l1.5 1"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="#FFD54F" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="#9FA8DA" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="#fff" cx="11" cy="13" r="2"/><path fill="#fff" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="#A5D6A7" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="#81C784" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="#B39DDB" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="#EF5350" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="#66BB6A" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="#FF7043" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

/**
 * Glyph theme - high contrast monochrome icons
 */
const GLYPH_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect fill="#000" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#000" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="#000" cx="12" cy="13.5" r="2.5"/><path fill="#fff" d="M12 11.5v2l1.5 1"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="#000" cx="11" cy="13" r="2"/><path fill="#000" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#000" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

/**
 * Gradient theme - folders with gradient fills
 */
const GRADIENT_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#64B5F6;stop-opacity:1" /><stop offset="100%" style="stop-color:#1976D2;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad1)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-lock" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFCA28;stop-opacity:1" /><stop offset="100%" style="stop-color:#F57C00;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-lock)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect fill="#fff" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#fff" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-cloud" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#4DD0E1;stop-opacity:1" /><stop offset="100%" style="stop-color:#0097A7;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-cloud)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-music" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#BA68C8;stop-opacity:1" /><stop offset="100%" style="stop-color:#7B1FA2;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-music)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-code" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#66BB6A;stop-opacity:1" /><stop offset="100%" style="stop-color:#2E7D32;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-code)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linecap="round" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-clock" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFB74D;stop-opacity:1" /><stop offset="100%" style="stop-color:#F57C00;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-clock)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="#fff" cx="12" cy="13.5" r="2.5"/><path stroke="#333" stroke-width="1" stroke-linecap="round" d="M12 12v1.5l1.2.8"/></svg>',
  star: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-star" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFD54F;stop-opacity:1" /><stop offset="100%" style="stop-color:#F57F17;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-star)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#fff" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-search" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#7986CB;stop-opacity:1" /><stop offset="100%" style="stop-color:#303F9F;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-search)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="none" stroke="#fff" stroke-width="1.5" cx="11" cy="13" r="2"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-plus" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#81C784;stop-opacity:1" /><stop offset="100%" style="stop-color:#388E3C;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-plus)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-check" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#66BB6A;stop-opacity:1" /><stop offset="100%" style="stop-color:#2E7D32;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-check)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-list" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#9575CD;stop-opacity:1" /><stop offset="100%" style="stop-color:#512DA8;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-list)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#fff" stroke-width="1.3" stroke-linecap="round" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-gift" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#EF5350;stop-opacity:1" /><stop offset="100%" style="stop-color:#C62828;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-gift)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-tree" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#66BB6A;stop-opacity:1" /><stop offset="100%" style="stop-color:#2E7D32;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-tree)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><defs><linearGradient id="grad-bell" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FF7043;stop-opacity:1" /><stop offset="100%" style="stop-color:#D84315;stop-opacity:1" /></linearGradient></defs><path fill="url(#grad-bell)" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
};

/**
 * macOS theme - Finder-style 3D folders with color variations
 */
const MACOS_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="#7DB3DC" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#5A9DD1" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="#F4A261" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E76F51" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><rect fill="#fff" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#fff" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="#90CAF9" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#64B5F6" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path fill="#fff" d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="#CE93D8" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#BA68C8" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path fill="#fff" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="#81C784" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#66BB6A" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="#FFB74D" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFA726" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><circle fill="#fff" cx="12" cy="13.5" r="2.5"/><path stroke="#333" stroke-width="1" stroke-linecap="round" d="M12 12v1.5l1.2.8"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="#FFD54F" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFCA28" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path fill="#fff" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="#9FA8DA" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#7986CB" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><circle fill="none" stroke="#fff" stroke-width="1.5" cx="11" cy="13" r="2"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="#A5D6A7" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#81C784" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="#81C784" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#66BB6A" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="#B39DDB" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#9575CD" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path stroke="#fff" stroke-width="1.3" stroke-linecap="round" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="#EF5350" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E53935" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="#66BB6A" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#4CAF50" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="#FF7043" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FF5722" opacity="0.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/></svg>',
};

/**
 * Windows theme - File Explorer yellow folder Fluent style
 */
const WINDOWS_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><rect fill="#37474F" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#37474F" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path fill="#1976D2" d="M14 11a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path fill="#7B1FA2" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path stroke="#2E7D32" stroke-width="1.3" stroke-linecap="round" fill="none" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><circle fill="#37474F" cx="12" cy="13.5" r="2.5"/><path stroke="#fff" stroke-width="1" stroke-linecap="round" d="M12 12v1.5l1.2.8"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path fill="#F57F17" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><circle fill="none" stroke="#303F9F" stroke-width="1.5" cx="11" cy="13" r="2"/><path stroke="#303F9F" stroke-width="1.5" stroke-linecap="round" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path stroke="#388E3C" stroke-width="1.5" stroke-linecap="round" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path stroke="#2E7D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/><path stroke="#512DA8" stroke-width="1.3" stroke-linecap="round" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="#FDD835" d="M3 8a1.5 1.5 0 0 1 1.5-1.5h5l1.5 1.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path fill="#F9A825" d="M3 8h18v1.5H3z"/></svg>',
};

/**
 * Christmas theme - snow-topped red/green holiday folders
 */
const CHRISTMAS_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><ellipse fill="#fff" opacity="0.7" cx="6" cy="7.5" rx="3" ry="1"/><ellipse fill="#fff" opacity="0.7" cx="17" cy="7.5" rx="4" ry="1"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><rect fill="#FFD54F" x="10" y="11.5" width="4" height="4" rx="0.3"/><path stroke="#FFD54F" stroke-width="1.5" d="M12 11.5v4M10 13.5h4"/><path fill="#EF5350" d="M11 11.5c0-1 .5-1.5 1-1.5s1 .5 1 1.5m-2 0c0-1-.5-1.5-1-1.5s-1 .5-1 1.5"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="#2E7D32" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path fill="#1B5E20" d="M12 10.5l-2 3h1l-1.5 2.5h5l-1.5-2.5h1z"/><rect fill="#5D4037" x="11.5" y="16" width="1" height="1"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="#FFD54F" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path fill="#D32F2F" d="M11 11h2l1 1.5c.5.5.5 1.5 0 2.5l-2 1-2-1c-.5-1-.5-2 0-2.5z"/><circle fill="#EF5350" cx="12" cy="16.5" r="0.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path fill="#FFD54F" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><rect fill="#FFD54F" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#FFD54F" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="#1976D2" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><ellipse fill="#fff" cx="6" cy="7.5" rx="3" ry="1"/><ellipse fill="#fff" cx="17" cy="7.5" rx="4" ry="1"/><path fill="#fff" d="M14 11.5a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path fill="#fff" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="#2E7D32" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><circle fill="#fff" cx="12" cy="13.5" r="2.5"/><path stroke="#C62828" stroke-width="1" stroke-linecap="round" d="M12 12v1.5l1.2.8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><circle fill="none" stroke="#fff" stroke-width="1.5" cx="11" cy="13" r="2"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="#2E7D32" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="#2E7D32" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="#C62828" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><ellipse fill="#fff" opacity="0.9" cx="12" cy="8" rx="10" ry="1.5"/><path stroke="#fff" stroke-width="1.3" stroke-linecap="round" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
};

/**
 * Lunar theme - auspicious clouds, red & gold lunar new year folders
 */
const LUNAR_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-grad"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-grad)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-gift"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-gift)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><rect fill="#FFD54F" x="10" y="11.5" width="4" height="4" rx="0.3"/><path stroke="#FFD54F" stroke-width="1.5" d="M12 11.5v4M10 13.5h4"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-tree"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-tree)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path fill="#FFD54F" d="M12 10.5l-2 3h1l-1.5 2.5h5l-1.5-2.5h1z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-bell"><stop offset="0%" stop-color="#FFD54F"/><stop offset="100%" stop-color="#F57F17"/></radialGradient></defs><path fill="url(#lunar-bell)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#D32F2F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path fill="#D32F2F" d="M11 11h2l1 1.5c.5.5.5 1.5 0 2.5l-2 1-2-1c-.5-1-.5-2 0-2.5z"/><circle fill="#EF5350" cx="12" cy="16.5" r="0.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-star"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-star)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path fill="#FFD54F" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-lock"><stop offset="0%" stop-color="#FFD54F"/><stop offset="100%" stop-color="#F57F17"/></radialGradient></defs><path fill="url(#lunar-lock)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#D32F2F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><rect fill="#D32F2F" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#D32F2F" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-cloud"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-cloud)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path fill="#FFD54F" d="M14 11.5a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-music"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-music)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path fill="#FFD54F" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-code"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-code)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path stroke="#FFD54F" stroke-width="1.3" stroke-linecap="round" fill="none" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-clock"><stop offset="0%" stop-color="#FFD54F"/><stop offset="100%" stop-color="#F57F17"/></radialGradient></defs><path fill="url(#lunar-clock)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#D32F2F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><circle fill="#D32F2F" cx="12" cy="13.5" r="2.5"/><path stroke="#FFD54F" stroke-width="1" stroke-linecap="round" d="M12 12v1.5l1.2.8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-search"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-search)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><circle fill="none" stroke="#FFD54F" stroke-width="1.5" cx="11" cy="13" r="2"/><path stroke="#FFD54F" stroke-width="1.5" stroke-linecap="round" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-plus"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-plus)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path stroke="#FFD54F" stroke-width="1.5" stroke-linecap="round" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-check"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-check)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path stroke="#FFD54F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><defs><radialGradient id="lunar-list"><stop offset="0%" stop-color="#D32F2F"/><stop offset="100%" stop-color="#B71C1C"/></radialGradient></defs><path fill="url(#lunar-list)" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#FFD54F" opacity="0.9" d="M6 7.5c.5-.3 1-.3 1.5 0s1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0 1 .3 1.5 0 1-.3 1.5 0c.3.2.5.2.5.3v.5c0 .3-.5.3-1 .3H6c-.5 0-1 0-1-.3V8c0-.3.5-.3 1-.5z"/><path stroke="#FFD54F" stroke-width="1.3" stroke-linecap="round" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
};

/**
 * Valentine theme - pink-edged heart folders
 */
const VALENTINE_ICONS: Record<FolderIconVariant, string> = {
  plain: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E91E63" d="M12 14.5c-1-.8-4-2.5-4-4.5 0-1.2.8-2 2-2 .8 0 1.5.5 2 1 .5-.5 1.2-1 2-1 1.2 0 2 .8 2 2 0 2-3 3.7-4 4.5z"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect fill="#EC407A" x="10" y="11.5" width="4" height="4" rx="0.3"/><path stroke="#EC407A" stroke-width="1.5" d="M12 11.5v4M10 13.5h4"/><path fill="#E91E63" d="M11 11.5c0-1 .5-1.5 1-1.5s1 .5 1 1.5m-2 0c0-1-.5-1.5-1-1.5s-1 .5-1 1.5"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E91E63" d="M12 14.5c-1-.8-4-2.5-4-4.5 0-1.2.8-2 2-2 .8 0 1.5.5 2 1 .5-.5 1.2-1 2-1 1.2 0 2 .8 2 2 0 2-3 3.7-4 4.5z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E91E63" d="M11 11h2l1 1.5c.5.5.5 1.5 0 2.5l-2 1-2-1c-.5-1-.5-2 0-2.5z"/><circle fill="#EC407A" cx="12" cy="16.5" r="0.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E91E63" d="m12 10.5-1 2-2 .3 1.5 1.4-.4 2 1.9-1 1.9 1-.4-2 1.5-1.4-2-.3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><rect fill="#E91E63" x="9.5" y="12.5" width="5" height="4" rx="0.5"/><path fill="#E91E63" d="M10.5 12.5v-1.5a1.5 1.5 0 0 1 3 0v1.5z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E91E63" d="M14 11.5a2.5 2.5 0 0 1 1 4.8v.2h-6v-.2a2.5 2.5 0 0 1 1-4.8 2 2 0 0 1 4 0"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="#E91E63" d="M10 15.5v-4l4-1v4M10 15.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#E91E63" stroke-width="1.3" stroke-linecap="round" fill="none" d="m10 11-2 2 2 2m4-4 2 2-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="#E91E63" cx="12" cy="13.5" r="2.5"/><path stroke="#F8BBD0" stroke-width="1" stroke-linecap="round" d="M12 12v1.5l1.2.8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle fill="none" stroke="#E91E63" stroke-width="1.5" cx="11" cy="13" r="2"/><path stroke="#E91E63" stroke-width="1.5" stroke-linecap="round" d="m12.5 14.5 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#E91E63" stroke-width="1.5" stroke-linecap="round" d="M12 11v5m-2.5-2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#E91E63" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" d="m9.5 13 1.5 1.5 3-3"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="#F8BBD0" stroke="#EC407A" stroke-width="1.5" d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="#E91E63" stroke-width="1.3" stroke-linecap="round" d="M8 11.5h8m-8 2h8m-8 2h5"/></svg>',
};

const ALL_THEMES: Record<FolderIconTheme, Record<FolderIconVariant, string>> = {
  outline: OUTLINE_ICONS,
  'filled-line': FILLED_LINE_ICONS,
  flat: FLAT_ICONS,
  glyph: GLYPH_ICONS,
  gradient: GRADIENT_ICONS,
  macos: MACOS_ICONS,
  windows: WINDOWS_ICONS,
  christmas: CHRISTMAS_ICONS,
  lunar: LUNAR_ICONS,
  valentine: VALENTINE_ICONS,
};

export function getFolderIconDefinition(theme: FolderIconTheme, variant: FolderIconVariant): FolderIconDefinition {
  return {
    theme,
    variant,
    svg: ALL_THEMES[theme][variant],
  };
}

export function getAllFolderIconThemes(): FolderIconTheme[] {
  return Object.keys(ALL_THEMES) as FolderIconTheme[];
}

export function getAllFolderIconVariants(): FolderIconVariant[] {
  return ['plain', 'lock', 'cloud', 'music', 'code', 'clock', 'star', 'search', 'plus', 'check', 'list', 'gift', 'tree', 'bell'];
}
