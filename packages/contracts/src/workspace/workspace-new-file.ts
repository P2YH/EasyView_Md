/**
 * Creatable workspace file types for New File menus (desktop + extension).
 * Seeds for OOXML extensions live in node-runtime `initialContentsForNewFile`.
 */
export type WorkspaceCreatableFileTypeId = 'markdown' | 'word' | 'excel' | 'text';

export interface WorkspaceCreatableFileType {
  readonly id: WorkspaceCreatableFileTypeId;
  /** Including the leading dot, e.g. `.md`. */
  readonly extension: string;
}

export const WORKSPACE_CREATABLE_FILE_TYPES: readonly WorkspaceCreatableFileType[] = [
  { id: 'markdown', extension: '.md' },
  { id: 'word', extension: '.docx' },
  { id: 'excel', extension: '.xlsx' },
  { id: 'text', extension: '.txt' },
] as const;

/** Pick an unused `stem` / `stem 2` / … + extension under a parent (case-insensitive). */
export function unusedWorkspaceCreateFileName(
  stem: string,
  extension: string,
  existingNames: readonly string[],
): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  let index = 0;
  for (;;) {
    const name = index === 0 ? `${stem}${ext}` : `${stem} ${index + 1}${ext}`;
    if (!taken.has(name.toLowerCase())) return name;
    index += 1;
  }
}

/** Folder default names: `stem` / `stem 2` / … */
export function unusedWorkspaceCreateFolderName(
  stem: string,
  existingNames: readonly string[],
): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  let index = 0;
  for (;;) {
    const name = index === 0 ? stem : `${stem} ${index + 1}`;
    if (!taken.has(name.toLowerCase())) return name;
    index += 1;
  }
}
