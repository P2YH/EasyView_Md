import { describe, expect, it } from 'vitest';
import { isOfficeLockFile } from './PreviewShell';
import { tPreview } from './preview.i18n';
import { viewerErrorMessage } from './viewers/shared';

describe('Office lock files', () => {
  it('recognizes ~$ owner files of Office documents only', () => {
    expect(isOfficeLockFile({ fileName: '~$12.6日选品.xlsx', route: 'spreadsheet' })).toBe(true);
    expect(isOfficeLockFile({ fileName: '~$报告.docx', route: 'word' })).toBe(true);
    expect(isOfficeLockFile({ fileName: '~$deck.pptx', route: 'powerpoint' })).toBe(true);
    expect(isOfficeLockFile({ fileName: '12.6日选品.xlsx', route: 'spreadsheet' })).toBe(false);
    expect(isOfficeLockFile({ fileName: '~$notes.txt', route: 'text' })).toBe(false);
  });
});

describe('viewer error message', () => {
  it('replaces the JSZip central-directory error with a readable explanation', () => {
    const jszip = new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html");
    expect(viewerErrorMessage(jszip)).toBe(tPreview('common.notZipDocument'));
  });

  it('keeps other error messages', () => {
    expect(viewerErrorMessage(new Error('HTTP 404'))).toBe('HTTP 404');
    expect(viewerErrorMessage('oops')).toBe(tPreview('common.failed'));
  });
});
