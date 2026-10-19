import JSZip from 'jszip';

const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);
/** Zip-based PowerPoint containers; legacy binary `.ppt` has no XML parts to read. */
export const PPTX_OUTLINE_SUFFIX = /\.(pptx|pptm|potx|potm|ppsx|ppsm)$/i;

function byLocalName(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter(element => element.localName === name);
}

function slideTitle(slide: Document): string {
  for (const shape of byLocalName(slide, 'sp')) {
    const type = byLocalName(shape, 'ph')[0]?.getAttribute('type');
    if (!type || !TITLE_PLACEHOLDERS.has(type)) continue;
    const text = byLocalName(shape, 'p')
      .map(paragraph => byLocalName(paragraph, 't').map(run => run.textContent ?? '').join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  return '';
}

/** Title placeholder text per slide in presentation order; untitled slides yield ''. */
export async function readPptxSlideTitles(data: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const parser = new DOMParser();
  const readXml = async (path: string): Promise<Document | null> => {
    const file = zip.file(path);
    return file ? parser.parseFromString(await file.async('string'), 'application/xml') : null;
  };
  const [presentation, rels] = await Promise.all([
    readXml('ppt/presentation.xml'),
    readXml('ppt/_rels/presentation.xml.rels'),
  ]);
  if (!presentation || !rels) return [];
  const targets = new Map(byLocalName(rels, 'Relationship').map(rel => [rel.getAttribute('Id'), rel.getAttribute('Target') ?? '']));
  return Promise.all(byLocalName(presentation, 'sldId').map(async (slideId) => {
    const relationship = Array.from(slideId.attributes)
      .find(attribute => attribute.namespaceURI === RELATIONSHIP_NS || attribute.name === 'r:id');
    const target = relationship && targets.get(relationship.value);
    if (!target) return '';
    const slide = await readXml(target.startsWith('/') ? target.slice(1) : `ppt/${target}`);
    return slide ? slideTitle(slide) : '';
  }));
}
