/**
 * Shared workspace-tree icons for Desktop + Extension.
 * File glyphs come from Seti-UI (same source as VS Code's default file icon theme).
 * Folders / roots use Seti-aligned silhouettes; Desktop paints SVG, Extension prefers
 * `resourceUri` + the workbench file-icon theme (Seti by default) for files/folders.
 */

import setiDefinitions from './seti/definitions.json';
import setiIcons from './seti/icons.json';

export type WorkspaceTreeIconKind = 'root' | 'directory' | 'file' | 'symlink';

export interface WorkspaceTreeIconDescriptor {
  /** Stable id for tests / debugging. */
  id: string;
  /** VS Code ThemeIcon / codicon id (used when a host opts into ThemeIcon). */
  codicon: string;
  /** Hex fill used by Desktop SVG. */
  color: string;
  /** Inline SVG markup (fill via currentColor on the host). */
  svg: string;
}

export interface ResolveWorkspaceTreeIconInput {
  kind: WorkspaceTreeIconKind;
  name: string;
  expanded?: boolean;
}

/** VS Code dark-theme Seti palette (from theme-seti iconDefinitions). */
export const SETI_THEME = {
  blue: '#519aba',
  grey: '#6d8086',
  'grey-light': '#748389',
  green: '#8dc149',
  orange: '#e37933',
  pink: '#f55385',
  purple: '#a074c4',
  red: '#cc3e44',
  white: '#d4d7d6',
  yellow: '#cbcb41',
  ignore: '#41535b',
} as const;

type SetiColorName = keyof typeof SETI_THEME;

type IconDetails = [string, string];

interface SetiDefinitions {
  default: IconDetails;
  extensions: Record<string, IconDetails>;
  files: Record<string, IconDetails>;
  partials: [string, IconDetails][];
}

const definitions = setiDefinitions as unknown as SetiDefinitions;
const icons = setiIcons as Record<string, string>;

/** Extra associations Seti-UI does not ship (common office/preview formats). */
const EXTRA_EXTENSIONS: Record<string, IconDetails> = {
  '.pptx': ['powerpoint', 'orange'],
  '.ppt': ['powerpoint', 'orange'],
  '.pptm': ['powerpoint', 'orange'],
  '.odp': ['powerpoint', 'orange'],
  '.xlsx': ['xls', 'green'],
  '.xlsm': ['xls', 'green'],
  '.ods': ['xls', 'green'],
  '.docx': ['word', 'blue'],
  '.docm': ['word', 'blue'],
  '.odt': ['word', 'blue'],
  '.drawio': ['drawio', 'orange'],
  '.dio': ['drawio', 'orange'],
  '.xmind': ['xmind', 'pink'],
  '.zip': ['zip', 'yellow'],
  '.rar': ['zip', 'yellow'],
  '.7z': ['zip', 'yellow'],
  '.tar': ['zip', 'yellow'],
  '.gz': ['zip', 'yellow'],
  '.tgz': ['zip', 'yellow'],
  '.bz2': ['zip', 'yellow'],
  '.xz': ['zip', 'yellow'],
  '.bmp': ['image', 'purple'],
  '.heic': ['image', 'purple'],
  '.mdx': ['markdown', 'blue'],
  '.mdc': ['markdown', 'blue'],
  '.m4v': ['video', 'pink'],
};

/** Office-style back sheet: four horizontal bands, lightest on top. */
function bandedSheet([top, upper, lower, bottom]: readonly [string, string, string, string]): string {
  return `<rect x="9" y="3" width="21" height="26" rx="2" fill="${bottom}"/>`
    + `<path fill="${top}" d="M11 3h17a2 2 0 0 1 2 2v4.5H9V5a2 2 0 0 1 2-2z"/>`
    + `<rect x="9" y="9.5" width="21" height="6.5" fill="${upper}"/>`
    + `<rect x="9" y="16" width="21" height="6.5" fill="${lower}"/>`;
}

/** Microsoft 365 layout: a dark tile with a white mark, overlapping a lighter back shape on its right. */
function officeIcon(back: string, tile: string, mark: string): string {
  return `<svg viewBox="0 0 32 32">${back}<rect x="1" y="7" width="18" height="18" rx="2" fill="${tile}"/>`
    + `<g transform="translate(10 16) scale(1.4) translate(-9.5 -16)">${mark}</g></svg>`;
}

const whiteMark = (d: string, transform?: string) =>
  `<path fill="#fff" fill-rule="evenodd"${transform ? ` transform="${transform}"` : ''} d="${d}"/>`;

const LETTER = /* @__PURE__ */ (() => ({
  W: whiteMark('M4 11.5h2.3l1 5.5 1.4-5.5h1.6l1.4 5.5 1-5.5H15l-2 9h-2.1l-1.4-5.2-1.4 5.2H6z'),
  X: whiteMark('M5 11.5h2.8l1.7 2.6 1.7-2.6H14l-3 4.5 3 4.5h-2.8l-1.7-2.6-1.7 2.6H5l3-4.5z'),
  P: whiteMark('M6.5 11.5h4a3.2 3.2 0 0 1 0 6.4H9v2.6H6.5zM9 13.6v2.2h1.4a1.1 1.1 0 0 0 0-2.2z'),
  M: whiteMark('M5 20.5v-9h2.4l2.1 3.5 2.1-3.5H14v9h-2.2v-5l-2.3 3.5-2.3-3.5v5z'),
  Z: whiteMark('M5 11.5h9v2.1l-5.7 4.8H14v2.1H5v-2.1l5.7-4.8H5z'),
}))();

/** Seti's Acrobat swirl (32×32), scaled into the tile. */
const PDF_MARK = /* @__PURE__ */ (() => whiteMark(icons.pdf?.match(/ d="([^"]+)"/)?.[1] ?? '', 'translate(.9 7.4) scale(.54)'))();
const MIND_MAP_MARK = /* @__PURE__ */ whiteMark(
  'M5 14.5h2.6a.8.8 0 0 1 .8.8v1.4a.8.8 0 0 1-.8.8H5a.8.8 0 0 1-.8-.8v-1.4a.8.8 0 0 1 .8-.8z'
    + 'M8.4 15.5h1.2v1H8.4zM9.6 12.4h1v7.2h-1zM10.6 12.4h.6v1h-.6zm0 3.1h.6v1h-.6zm0 3.1h.6v1h-.6z'
    + 'M11.8 11.7h2.2a.6.6 0 0 1 .6.6v1.2a.6.6 0 0 1-.6.6h-2.2a.6.6 0 0 1-.6-.6v-1.2a.6.6 0 0 1 .6-.6z'
    + 'M11.8 14.8h2.2a.6.6 0 0 1 .6.6v1.2a.6.6 0 0 1-.6.6h-2.2a.6.6 0 0 1-.6-.6v-1.2a.6.6 0 0 1 .6-.6z'
    + 'M11.8 17.9h2.2a.6.6 0 0 1 .6.6v1.2a.6.6 0 0 1-.6.6h-2.2a.6.6 0 0 1-.6-.6v-1.2a.6.6 0 0 1 .6-.6z',
);
const IMAGE_MARK = /* @__PURE__ */ whiteMark('M4.5 20.5 8 15.8l2.4 3 1.9-2.3 3.2 4zM12.3 11.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z');
const PLAY_MARK = /* @__PURE__ */ whiteMark('M7 11.2v9.6l7.8-4.8z');
const NOTE_MARK = /* @__PURE__ */ whiteMark(
  'M14.5 11v7.3a2.1 2.1 0 1 1-1.5-2v-3.2l-4.6 1.1v5.1a2.1 2.1 0 1 1-1.5-2v-5.3z',
);
/** Film strip back sheet: dark frame, lighter picture area, sprocket holes down the right edge. */
const FILM_STRIP = /* @__PURE__ */ '<rect x="9" y="3" width="21" height="26" rx="2" fill="#880E4F"/>'
  + '<rect x="19" y="5" width="6" height="22" fill="#E91E63"/>'
  + [5.5, 10.5, 15.5, 20.5, 25.5].map((y) => `<rect x="26.5" y="${y - 1}" width="2" height="2" rx=".4" fill="#F8BBD0"/>`).join('');
/** Waveform back sheet: dark sheet with lighter level bars. */
const WAVEFORM = /* @__PURE__ */ '<rect x="9" y="3" width="21" height="26" rx="2" fill="#00695C"/>'
  + [[20, 12, 8], [23, 8, 16], [26, 13, 6]].map(([x, y, h]) => `<rect x="${x}" y="${y}" width="2" height="${h}" rx="1" fill="#80CBC4"/>`).join('');

/** Full-colour glyphs that are inserted as-is instead of being painted with the Seti colour. */
const FULL_COLOR_ICONS: Record<string, string> = /* @__PURE__ */ (() => ({
  word: officeIcon(bandedSheet(['#41A5EE', '#2B7CD3', '#185ABD', '#103F91']), '#11479E', LETTER.W),
  xls: officeIcon(
    bandedSheet(['#21A366', '#107C41', '#185C37', '#185C37'])
      + '<path fill="#33C481" d="M19.5 3H28a2 2 0 0 1 2 2v4.5H19.5z"/>'
      + '<rect x="19.5" y="9.5" width="10.5" height="6.5" fill="#21A366"/>'
      + '<rect x="19.5" y="16" width="10.5" height="6.5" fill="#107C41"/>',
    '#0E6B38',
    LETTER.X,
  ),
  powerpoint: officeIcon(
    '<circle cx="19" cy="16" r="12" fill="#D35230"/>'
      + '<path fill="#ED6C47" d="M7 16a12 12 0 0 1 24 0z"/>'
      + '<path fill="#FF8F6B" d="M19 4a12 12 0 0 1 12 12H19z"/>',
    '#C43E1C',
    LETTER.P,
  ),
  markdown: officeIcon(
    '<path fill="#24465C" d="M11 3h13l6 6v18a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>'
      + '<path fill="#53798E" d="m24 3 6 6h-4a2 2 0 0 1-2-2z"/>'
      + '<path fill="#66D3E2" d="M23 11.5h3v5.5h2.5L24.5 22l-4-5H23z"/>',
    '#286AA0',
    LETTER.M,
  ),
  xmind: officeIcon(bandedSheet(['#F8A5C2', '#F06292', '#E04381', '#C2185B']), '#AD1457', MIND_MAP_MARK),
  zip: officeIcon(bandedSheet(['#F7CB4D', '#F0B429', '#DE9B0F', '#C2830A']), '#9C6500', LETTER.Z),
  pdf: officeIcon(bandedSheet(['#F47C6A', '#E2574C', '#C93B30', '#A8281F']), '#B30B00', PDF_MARK),
  image: officeIcon(
    '<rect x="9" y="3" width="21" height="26" rx="2" fill="#7E57C2"/>'
      + '<path fill="#B39DDB" d="M11 3h17a2 2 0 0 1 2 2v9H9V5a2 2 0 0 1 2-2z"/>'
      + '<path fill="#5E35B1" d="m17 29 6-9.5 7 9.5z"/>'
      + '<circle cx="25" cy="9" r="2.4" fill="#FFD54F"/>',
    '#5E35B1',
    IMAGE_MARK,
  ),
  video: officeIcon(FILM_STRIP, '#C2185B', PLAY_MARK),
  audio: officeIcon(WAVEFORM, '#00796B', NOTE_MARK),
}))();

/** Single-colour Seti-style glyphs for formats missing from the upstream Seti icon font. */
const CUSTOM_ICONS: Record<string, string> = {
  drawio:
    '<svg viewBox="0 0 32 32"><path d="M7.2 5.5h8.4c1 0 1.8.8 1.8 1.8v5.2c0 1-.8 1.8-1.8 1.8H7.2c-1 0-1.8-.8-1.8-1.8V7.3c0-1 .8-1.8 1.8-1.8zm9.2 9.8 5.4 3.2c.9.5.9 1.8 0 2.3l-5.4 3.2c-.9.5-2-.1-2-1.2v-6.3c0-1.1 1.1-1.7 2-1.2zM6.8 20.2h8c.9 0 1.6.7 1.6 1.6v4.1c0 .9-.7 1.6-1.6 1.6h-8c-.9 0-1.6-.7-1.6-1.6v-4.1c0-.9.7-1.6 1.6-1.6z"/></svg>',
};

const FOLDER_CLOSED_PATH =
  'M27.4 8.5H15.8V7.2c0-1.3-1-2.3-2.3-2.3H3.5v20.3h25.1V10.8c0-1.3-.9-2.3-2.2-2.3z';
const FOLDER_OPEN_PATH =
  'M28.2 12.2H16.1l-1.5-2.1c-.3-.4-.8-.7-1.3-.7H3.8c-1.2 0-2.2 1-2.2 2.2v14.1c0 1.2 1 2.2 2.2 2.2h24.4c1.2 0 2.2-1 2.2-2.2v-11.3c0-1.2-1-2.2-2.2-2.2z';
const SYMLINK_PATH =
  'M22.5 6.5h-5.2v2.2h3.3l-6.2 6.2-1.6-1.6-6.3 6.3 1.6 1.6 6.3-6.3 1.6 1.6 6.2-6.2v3.3h2.2V6.5h-1.9zM8.8 8.7H3.6v13.8h13.8v-5.2h-2.2v3H5.8V10.9h3v-2.2z';

function folderSvg(open: boolean, color: string): string {
  const d = open ? FOLDER_OPEN_PATH : FOLDER_CLOSED_PATH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32" fill="${color}" aria-hidden="true"><path d="${d}"/></svg>`;
}

function symlinkSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32" fill="${color}" aria-hidden="true"><path d="${SYMLINK_PATH}"/></svg>`;
}

function paintSvg(raw: string, color: string): string {
  if (raw.includes('fill=')) {
    return raw.replace(/fill="[^"]*"/g, `fill="${color}"`);
  }
  return raw.replace('<svg', `<svg fill="${color}"`);
}

function basenameOf(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function lookupSetiDetails(fileName: string): IconDetails {
  const base = basenameOf(fileName);
  const lower = base.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(definitions.files, base)) {
    return definitions.files[base];
  }
  if (Object.prototype.hasOwnProperty.call(definitions.files, lower)) {
    return definitions.files[lower];
  }

  let extension = lower.includes('.') ? lower.slice(lower.indexOf('.')) : '';
  while (extension) {
    if (Object.prototype.hasOwnProperty.call(EXTRA_EXTENSIONS, extension)) {
      return EXTRA_EXTENSIONS[extension];
    }
    if (Object.prototype.hasOwnProperty.call(definitions.extensions, extension)) {
      return definitions.extensions[extension];
    }
    const nextDot = extension.indexOf('.', 1);
    extension = nextDot >= 0 ? extension.slice(nextDot) : '';
  }

  for (const [partial, details] of definitions.partials) {
    if (lower.includes(partial.toLowerCase())) return details;
  }

  return definitions.default;
}

function setiFileIcon(fileName: string): WorkspaceTreeIconDescriptor {
  const [iconName, colorName] = lookupSetiDetails(fileName);
  const color = SETI_THEME[(colorName as SetiColorName)] ?? SETI_THEME.white;
  const raw = CUSTOM_ICONS[iconName] ?? icons[iconName] ?? icons[definitions.default[0]] ?? icons.default;
  const svg = FULL_COLOR_ICONS[iconName] ?? paintSvg(raw || '<svg viewBox="0 0 32 32"></svg>', color);
  return {
    id: `seti:${iconName}`,
    codicon: codiconForSeti(iconName),
    color,
    svg,
  };
}

function codiconForSeti(iconName: string): string {
  switch (iconName) {
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'pdf':
      return 'file-pdf';
    case 'powerpoint':
      return 'file-media';
    case 'drawio':
    case 'xmind':
      return 'type-hierarchy';
    case 'xls':
    case 'csv':
      return 'table';
    case 'word':
      return 'file';
    case 'image':
    case 'svg':
    case 'video':
    case 'audio':
      return 'file-media';
    case 'zip':
    case 'rar':
      return 'file-zip';
    case 'git':
      return 'git-commit';
    case 'config':
    case 'settings':
      return 'settings-gear';
    case 'lock':
      return 'lock';
    case 'database':
    case 'sql':
      return 'database';
    case 'python':
    case 'javascript':
    case 'typescript':
    case 'html':
    case 'css':
    case 'c':
    case 'cpp':
    case 'c-sharp':
    case 'java':
    case 'go':
    case 'rust':
    case 'ruby':
    case 'php':
      return 'file-code';
    default:
      return 'file';
  }
}

/** Resolve the shared icon descriptor for a workspace tree node. */
export function resolveWorkspaceTreeIcon(input: ResolveWorkspaceTreeIconInput): WorkspaceTreeIconDescriptor {
  const expanded = Boolean(input.expanded);
  const folderColor = '#dcb67a';

  if (input.kind === 'root') {
    return {
      id: expanded ? 'root-folder-opened' : 'root-folder',
      codicon: expanded ? 'root-folder-opened' : 'root-folder',
      color: folderColor,
      svg: folderSvg(expanded, folderColor),
    };
  }

  if (input.kind === 'directory') {
    const base = basenameOf(input.name);
    // Dot-directories (.git / .vscode / …) use a config glyph, not the yellow folder.
    if (base.startsWith('.')) {
      const color = SETI_THEME.grey;
      const raw = icons.config ?? icons[definitions.default[0]] ?? icons.default;
      return {
        id: expanded ? 'folder-dot-opened' : 'folder-dot',
        codicon: 'settings-gear',
        color,
        svg: paintSvg(raw || '<svg viewBox="0 0 32 32"></svg>', color),
      };
    }
    return {
      id: expanded ? 'folder-opened' : 'folder',
      codicon: expanded ? 'folder-opened' : 'folder',
      color: folderColor,
      svg: folderSvg(expanded, folderColor),
    };
  }

  if (input.kind === 'symlink') {
    return {
      id: 'file-symlink',
      codicon: 'file-symlink-file',
      color: SETI_THEME.purple,
      svg: symlinkSvg(SETI_THEME.purple),
    };
  }

  return setiFileIcon(input.name);
}

export function workspaceTreeIconCodicon(input: ResolveWorkspaceTreeIconInput): string {
  return resolveWorkspaceTreeIcon(input).codicon;
}

export interface WorkspaceFileIconTheme {
  /** VS Code file icon theme JSON; icon paths are relative to the theme file. */
  theme: Record<string, unknown>;
  /** SVG files keyed by path relative to the theme file. */
  files: Record<string, string>;
}

/**
 * Builds a VS Code file icon theme from the same descriptors the workspace tree paints, so the
 * Extension's native tabs and explorer can match the sidebar. Seti "partials" are not expressible.
 */
export function buildWorkspaceFileIconTheme(): WorkspaceFileIconTheme {
  const iconDefinitions: Record<string, { iconPath: string }> = {};
  const files: Record<string, string> = {};
  const define = (descriptor: WorkspaceTreeIconDescriptor): string => {
    const key = `${descriptor.id}_${descriptor.color}`.replace(/[^a-z0-9_-]/gi, '_');
    if (!iconDefinitions[key]) {
      const svg = descriptor.svg.includes('xmlns=')
        ? descriptor.svg
        : descriptor.svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      files[`icons/${key}.svg`] = svg;
      iconDefinitions[key] = { iconPath: `./icons/${key}.svg` };
    }
    return key;
  };

  const fileExtensions: Record<string, string> = {};
  for (const extension of new Set([...Object.keys(definitions.extensions), ...Object.keys(EXTRA_EXTENSIONS)])) {
    fileExtensions[extension.replace(/^\./, '').toLowerCase()] = define(resolveWorkspaceTreeIcon({ kind: 'file', name: `file${extension}` }));
  }
  const fileNames: Record<string, string> = {};
  for (const name of Object.keys(definitions.files)) {
    fileNames[name.toLowerCase()] = define(resolveWorkspaceTreeIcon({ kind: 'file', name }));
  }

  return {
    theme: {
      iconDefinitions,
      file: define(resolveWorkspaceTreeIcon({ kind: 'file', name: 'file' })),
      folder: define(resolveWorkspaceTreeIcon({ kind: 'directory', name: 'folder' })),
      folderExpanded: define(resolveWorkspaceTreeIcon({ kind: 'directory', name: 'folder', expanded: true })),
      rootFolder: define(resolveWorkspaceTreeIcon({ kind: 'root', name: 'root' })),
      rootFolderExpanded: define(resolveWorkspaceTreeIcon({ kind: 'root', name: 'root', expanded: true })),
      fileExtensions,
      fileNames,
    },
    files,
  };
}
