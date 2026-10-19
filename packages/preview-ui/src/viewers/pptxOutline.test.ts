/** @vitest-environment jsdom */
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { PPTX_OUTLINE_SUFFIX, readPptxSlideTitles } from './pptxOutline';

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function shape(placeholder: string, ...paragraphs: string[]): string {
  const ph = placeholder ? `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr>` : '<p:nvPr/>';
  const body = paragraphs.map(text => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr>${ph}</p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;
}

it('reads title placeholders in presentation order', async () => {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation ${P}><p:sldIdLst><p:sldId id="257" r:id="rId9"/><p:sldId id="256" r:id="rId8"/><p:sldId id="258" r:id="rId7"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId8" Target="slides/slide1.xml"/><Relationship Id="rId9" Target="slides/slide2.xml"/><Relationship Id="rId7" Target="/ppt/slides/slide3.xml"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', `<p:sld ${P}><p:cSld><p:spTree>${shape('', 'Body text')}${shape('title', 'Second', 'slide')}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/slide2.xml', `<p:sld ${P}><p:cSld><p:spTree>${shape('ctrTitle', 'Cover')}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/slide3.xml', `<p:sld ${P}><p:cSld><p:spTree>${shape('body', 'No title')}</p:spTree></p:cSld></p:sld>`);

  const titles = await readPptxSlideTitles(await zip.generateAsync({ type: 'arraybuffer' }));

  expect(titles).toEqual(['Cover', 'Second slide', '']);
});

it('only targets zip-based PowerPoint files', () => {
  expect(PPTX_OUTLINE_SUFFIX.test('deck.PPTX')).toBe(true);
  expect(PPTX_OUTLINE_SUFFIX.test('show.ppsx')).toBe(true);
  expect(PPTX_OUTLINE_SUFFIX.test('legacy.ppt')).toBe(false);
});
