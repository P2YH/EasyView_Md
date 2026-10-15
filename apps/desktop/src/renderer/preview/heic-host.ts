import heic2any from 'heic2any';
import { normalizeLocale, setLocale } from '@easyview/contracts/i18n';
import { tPreview } from './preview.i18n';

const locale = normalizeLocale(new URLSearchParams(window.location.search).get('locale'));
if (locale) {
  setLocale(locale);
  document.documentElement.lang = locale;
}

interface DecodeMessage {
  type: 'decode-heic';
  token: string;
  bytes: ArrayBuffer;
  mimeType: string;
  background?: string;
  color?: string;
}

interface ThemeMessage {
  type: 'set-theme';
  token: string;
  background?: string;
  color?: string;
}

type HostMessage = DecodeMessage | ThemeMessage;

let currentUrl: string | null = null;
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (!message || typeof message.token !== 'string') return;
  applyTheme(message.background, message.color);
  if (message.type === 'set-theme') return;
  if (!(message.bytes instanceof ArrayBuffer)) return;
  void decode(message).catch((error) => {
    document.body.textContent = error instanceof Error ? error.message : tPreview('heic.decodeFailed');
    event.source?.postMessage({ type: 'heic-error', token: message.token, message: document.body.textContent }, { targetOrigin: '*' });
  });
});

function applyTheme(background: string | undefined, color: string | undefined): void {
  if (typeof background === 'string' && background.length <= 128) {
    document.documentElement.style.background = background;
    document.body.style.background = background;
  }
  if (typeof color === 'string' && color.length <= 128) {
    document.documentElement.style.color = color;
    document.body.style.color = color;
  }
}

async function decode(message: DecodeMessage): Promise<void> {
  const result = await heic2any({
    blob: new Blob([message.bytes], { type: message.mimeType || 'image/heic' }),
    toType: 'image/png',
  });
  const image = Array.isArray(result) ? result[0] : result;
  if (!(image instanceof Blob)) throw new Error(tPreview('heic.noImage'));
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(image);
  const element = document.createElement('img');
  element.alt = tPreview('heic.alt');
  element.src = currentUrl;
  document.body.replaceChildren(element);
  await element.decode();
  window.parent.postMessage({ type: 'heic-ready', token: message.token }, '*');
}

window.addEventListener('unload', () => { if (currentUrl) URL.revokeObjectURL(currentUrl); }, { once: true });
