import path from 'node:path';

/**
 * Resolve a file path to a path relative to the IndexArea root, tolerating
 * NFC/NFD differences (macOS), trailing slashes and, on case-insensitive
 * platforms, letter case. Returns undefined when the file is outside the root.
 */
export function indexAreaRelativePath(
  rootPath: string,
  filePath: string,
  options: { caseInsensitive?: boolean } = {},
): string | undefined {
  const normalize = (value: string): string => {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/')).normalize('NFC');
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
  };
  const root = normalize(rootPath);
  const file = normalize(filePath);
  const fold = (value: string): string => (options.caseInsensitive ? value.toLowerCase() : value);
  const relative = path.posix.relative(fold(root), fold(file));
  if (relative === '') return '';
  if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) return undefined;
  // Preserve the original casing of the file path segment.
  return file.slice(file.length - relative.length);
}
