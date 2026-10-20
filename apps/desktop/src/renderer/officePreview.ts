/** Helpers for AI Agent editing of preview (non-Markdown) tabs. Phase 1 supports .xlsx only. */

export function isAgentEditablePreview(relativePath: string): boolean {
  return /\.xlsx$/i.test(relativePath);
}

/** True when an absolute host path points at the given workspace-relative preview path. */
export function previewPathMatches(absolutePath: string, relativePath: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const absolute = normalize(absolutePath);
  const relative = normalize(relativePath).replace(/^\.\//, '');
  return relative.length > 0 && (absolute === relative || absolute.endsWith(`/${relative}`));
}
