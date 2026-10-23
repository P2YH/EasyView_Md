import { describe, expect, it } from 'vitest';
import { needsBasicPreviewToolbar } from './BasicPreviewShell';
import type { PreviewDescriptor } from '@easyview/contracts';

function descriptor(fileName: string, route: PreviewDescriptor['route']): PreviewDescriptor {
  return {
    sessionId: 's',
    relativePath: fileName,
    fileName,
    route,
    size: 1,
    mtimeMs: 1,
    mimeType: 'application/octet-stream',
    contentUrl: 'about:blank',
  };
}

describe('needsBasicPreviewToolbar', () => {
  it('uses contract chrome and excludes text / document routes', () => {
    expect(needsBasicPreviewToolbar(descriptor('a.svg', 'svg'))).toBe(true);
    expect(needsBasicPreviewToolbar(descriptor('a.html', 'html'))).toBe(true);
    expect(needsBasicPreviewToolbar(descriptor('a.mp4', 'video'))).toBe(true);
    expect(needsBasicPreviewToolbar(descriptor('a.py', 'text'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.pdf', 'pdf'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.png', 'image'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.heic', 'image'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.heif', 'image'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.pptx', 'powerpoint'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.ppt', 'powerpoint'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.xlsx', 'spreadsheet'))).toBe(false);
    expect(needsBasicPreviewToolbar(descriptor('a.docx', 'word'))).toBe(false);
  });
});
