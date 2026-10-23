import { isPreviewWritableFile, resolvePreviewRoute } from '@easyview/contracts';

/** Word OOXML suffixes that open as the editable document route (contract writableSuffixes). */
export const EDITABLE_WORD_SUFFIXES = ['.docx', '.dotx'] as const;

export function isEditableWordFile(fileName: string): boolean {
  return resolvePreviewRoute(fileName)?.route === 'word' && isPreviewWritableFile(fileName);
}
