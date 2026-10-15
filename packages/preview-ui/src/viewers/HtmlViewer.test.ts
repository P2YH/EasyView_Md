import { afterEach, describe, expect, it } from 'vitest';
import { resetLocale, setLocale } from '@easyview/contracts/i18n';
import {
  htmlDocumentWithBase,
  htmlPreviewBaseHref,
  htmlRewriteRelativeUrls,
  isHtmlPreviewAssetHref,
  isLocalHttpPreviewUrl,
} from './HtmlViewer';

describe('html preview document', () => {
  afterEach(() => resetLocale());

  it('turns a page URL into a directory base href', () => {
    expect(htmlPreviewBaseHref('easyview-preview://content/11111111-1111-4111-8111-111111111111/page.html'))
      .toBe('easyview-preview://content/11111111-1111-4111-8111-111111111111/');
    expect(htmlPreviewBaseHref('https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/index.html'))
      .toBe('https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/');
  });

  it('injects base and iframe proxy bootstrap without rewriting page styles', () => {
    const html = htmlDocumentWithBase(
      '<html><head><title>Demo</title></head><body><h1>Hi</h1></body></html>',
      'easyview-preview://content/id/',
    );
    expect(html).toContain('<base href="easyview-preview://content/id/">');
    expect(html).toContain('easyview-html');
    expect(html).toContain('reportReady');
    expect(html).toContain('postToHost');
    expect(html).toContain('HTMLIFrameElement');
    expect(html).toContain('<h1>Hi</h1>');
    expect(html).not.toContain('!important');
  });

  it('localizes nested frame failure text inside the bootstrap', () => {
    expect(htmlDocumentWithBase('<p>x</p>', 'easyview-preview://content/id/')).toContain('"无法加载页面："');
    setLocale('en');
    const html = htmlDocumentWithBase('<p>x</p>', 'easyview-preview://content/id/');
    expect(html).toContain('"Unable to load page: "');
    expect(html).toContain('"timeout"');
  });

  it('rewrites relative iframe and script urls against the page directory', () => {
    const html = htmlRewriteRelativeUrls(
      '<iframe src="dsmp/page.html"></iframe><script src="nav.js"></script>',
      'https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/',
    );
    expect(html).toContain('https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/dsmp/page.html');
    expect(html).toContain('https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/nav.js');
  });

  it('detects local http preview URLs', () => {
    expect(isLocalHttpPreviewUrl('http://127.0.0.1:4123/token/page.html')).toBe(true);
    expect(isLocalHttpPreviewUrl('https://file+.vscode-resource.vscode-cdn.net/tmp/page.html')).toBe(false);
  });

  it('only allows sibling fetches on the same preview origin', () => {
    const contentUrl = 'https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/index.html';
    expect(isHtmlPreviewAssetHref('https://file+.vscode-resource.vscode-cdn.net/Users/demo/site/dsmp/a.html', contentUrl)).toBe(true);
    expect(isHtmlPreviewAssetHref('https://example.com/dsmp/a.html', contentUrl)).toBe(false);
  });
});
