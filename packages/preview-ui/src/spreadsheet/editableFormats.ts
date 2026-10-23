import { isPreviewWritableFile, resolvePreviewRoute } from '@easyview/contracts';

/** Spreadsheet suffixes that open as the editable document route. Others stay on UniversalFilePreview. */
export const EDITABLE_SPREADSHEET_SUFFIXES = ['.xlsx', '.xlsm'] as const;

export function isEditableSpreadsheetFile(fileName: string): boolean {
  return resolvePreviewRoute(fileName)?.route === 'spreadsheet' && isPreviewWritableFile(fileName);
}
