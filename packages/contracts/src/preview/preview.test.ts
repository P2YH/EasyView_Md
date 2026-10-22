import { describe, expect, it } from 'vitest';
import { resolvePreviewRoute } from './preview';

describe('preview routes', () => {
  it('keeps Markdown in the editor and routes supported preview formats', () => {
    expect(resolvePreviewRoute('notes.md')).toBeNull();
    expect(resolvePreviewRoute('rule.mdc')).toBeNull();
    expect(resolvePreviewRoute('clip.MP4')).toMatchObject({ route: 'video', mimeType: 'video/mp4' });
    expect(resolvePreviewRoute('clip.m4v')?.route).toBe('video');
    expect(resolvePreviewRoute('song.MP3')).toMatchObject({ route: 'audio', mimeType: 'audio/mpeg' });
    expect(resolvePreviewRoute('voice.m4a')).toMatchObject({ route: 'audio', mimeType: 'audio/mp4' });
    for (const name of ['a.wav', 'a.ogg', 'a.oga', 'a.flac']) expect(resolvePreviewRoute(name)?.route).toBe('audio');
    expect(resolvePreviewRoute('request.http')?.route).toBe('http');
    expect(resolvePreviewRoute('font.woff2')?.route).toBe('font');
    expect(resolvePreviewRoute('archive.tar.gz')?.route).toBe('archive');
    expect(resolvePreviewRoute('extension.vsix')?.route).toBe('archive');
    expect(resolvePreviewRoute('bundle.zip')?.route).toBe('archive');
    expect(resolvePreviewRoute('flow.drawio')?.route).toBe('design');
    expect(resolvePreviewRoute('diagram.dio')?.route).toBe('design');
    expect(resolvePreviewRoute('map.xmind')?.route).toBe('design');
  });

  it('routes lightweight spreadsheet/text-table previews to spreadsheet (PDF-style chrome)', () => {
    expect(resolvePreviewRoute('table.csv')?.route).toBe('spreadsheet');
    expect(resolvePreviewRoute('table.tsv')?.route).toBe('spreadsheet');
    expect(resolvePreviewRoute('legacy.xls')?.route).toBe('spreadsheet');
    expect(resolvePreviewRoute('sheet.ods')?.route).toBe('spreadsheet');
    expect(resolvePreviewRoute('old.doc')?.route).toBe('word');
  });
});
