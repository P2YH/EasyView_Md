import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';

/** Resolve a CodeMirror language extension for a preview filename (best-effort). */
export async function languageExtensionForFile(fileName: string): Promise<Extension | null> {
  const base = fileName.includes('/') ? fileName.slice(fileName.lastIndexOf('/') + 1) : fileName;
  const matched = LanguageDescription.matchFilename(languages, base);
  if (!matched) return null;
  try {
    const support = await matched.load();
    return support;
  } catch {
    return null;
  }
}
