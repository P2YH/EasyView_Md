import * as React from 'react';
import type { HttpPreviewResponse, PreviewTextResult } from '@easyview/contracts';
import { h, Loading, ViewerError, type ViewerProps } from './shared';
import { tPreview } from '../preview.i18n';

export interface HttpViewerProps extends ViewerProps {
  readText(sessionId: string): Promise<PreviewTextResult>;
  send(request: { url: string; method: 'GET'; headers: Record<string, string> }): Promise<HttpPreviewResponse>;
}

/** HTTP files remain inert until the user explicitly presses Send. */
export function HttpViewer({ descriptor, readText, send }: HttpViewerProps): React.ReactElement {
  const [url, setUrl] = React.useState<string | null>(null);
  const [response, setResponse] = React.useState<HttpPreviewResponse | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    let disposed = false;
    void readText(descriptor.sessionId).then(({ content }) => {
      if (disposed) return;
      const requestLine = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? '';
      const match = requestLine.match(/^(?:GET\s+)?(https?:\/\/\S+)/i);
      setUrl(match?.[1] ?? '');
    }).catch((reason) => { if (!disposed) setError(reason); });
    return () => { disposed = true; };
  }, [descriptor.sessionId, readText]);
  if (url === null) return h(Loading, { label: tPreview('http.reading') });
  const submit = () => {
    if (!url.trim() || pending) return;
    setPending(true); setError(null);
    void send({ url: url.trim(), method: 'GET', headers: {} }).then(setResponse).catch(setError).finally(() => setPending(false));
  };
  return h('section', { className: 'preview-http-viewer' },
    h('div', { className: 'preview-http-request', role: 'toolbar' },
      h('input', { value: url, placeholder: 'https://example.com/api', onChange: (event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.currentTarget.value) }),
      h('button', {
        type: 'button', disabled: pending, onClick: submit,
        title: pending ? tPreview('http.sending') : tPreview('http.send'),
        'aria-label': pending ? tPreview('http.sending') : tPreview('http.send'),
      }, h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('path', { d: 'm3 3 18 9-18 9 4-9-4-9Zm4 9h14', strokeLinejoin: 'round' }),
      )),
    ),
    error ? h(ViewerError, { error }) : null,
    response ? h('article', { className: 'preview-http-response' }, h('p', null, `${response.status} ${response.statusText}`), response.truncated ? h('p', { className: 'preview-notice' }, tPreview('http.truncated')) : null, h('pre', null, response.body)) : null,
  );
}
