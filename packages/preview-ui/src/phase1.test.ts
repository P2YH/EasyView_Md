import { describe, expect, it } from 'vitest';
import {
  DESKTOP_ONLY_PREVIEW_ROUTES,
  isDesktopOnlyPreviewRoute,
  isPhase1PreviewRoute,
  PHASE1_PREVIEW_ROUTES,
} from './phase1';

describe('phase-1 preview routes', () => {
  it('recognizes the shared phase-1 set', () => {
    expect(PHASE1_PREVIEW_ROUTES).toContain('spreadsheet');
    expect(PHASE1_PREVIEW_ROUTES).toContain('powerpoint');
    expect(PHASE1_PREVIEW_ROUTES).toContain('design');
    expect(PHASE1_PREVIEW_ROUTES).toContain('archive');
    expect(PHASE1_PREVIEW_ROUTES).toContain('epub');
    expect(PHASE1_PREVIEW_ROUTES).toContain('font');
    expect(isPhase1PreviewRoute('pdf')).toBe(true);
    expect(isPhase1PreviewRoute('design')).toBe(true);
    expect(isPhase1PreviewRoute('archive')).toBe(true);
    expect(isPhase1PreviewRoute('epub')).toBe(true);
    expect(isPhase1PreviewRoute('font')).toBe(true);
    expect(isPhase1PreviewRoute('http')).toBe(false);
    expect(isPhase1PreviewRoute('java-class')).toBe(false);
    expect(isPhase1PreviewRoute(null)).toBe(false);
  });

  it('marks http and java-class as desktop-only', () => {
    expect(DESKTOP_ONLY_PREVIEW_ROUTES).toEqual(['http', 'java-class']);
    expect(isDesktopOnlyPreviewRoute('http')).toBe(true);
    expect(isDesktopOnlyPreviewRoute('java-class')).toBe(true);
    expect(isDesktopOnlyPreviewRoute('epub')).toBe(false);
  });
});
