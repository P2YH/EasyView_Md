import * as React from 'react';
import {
  PreviewShell as SharedPreviewShell,
  createLocalPreviewThemeStorage,
  h,
  type PreviewAssetConfig,
  type PreviewExtraViewers,
  type PreviewHost,
} from '@easyview/preview-ui';
import { getLocale } from '@easyview/contracts/i18n';
import type { PreviewController } from './PreviewController';
import { tPreview } from './preview.i18n';

let desktopAssets: PreviewAssetConfig | undefined;

function getDesktopAssets(): PreviewAssetConfig {
  desktopAssets ??= {
    fileViewerAssetBaseUrl: new URL('./vendor/file-viewer/', window.location.href).toString(),
    pptAssetBaseUrl: new URL('./vendor/file-viewer-ppt/', window.location.href).toString(),
    docWorkerUrl: localizedAssetUrl('./workers/doc-worker.js'),
    heicHostUrl: localizedAssetUrl('./heic-host.html'),
    themeStorage: createLocalPreviewThemeStorage(window.localStorage),
  };
  return desktopAssets;
}

function localizedAssetUrl(relativeUrl: string): string {
  const url = new URL(relativeUrl, window.location.href);
  url.searchParams.set('locale', getLocale());
  return url.toString();
}

const extraViewers: PreviewExtraViewers = {
  epub: () => import('./viewers/DesignViewer').then(({ DesignViewer }) => (descriptor) => h(DesignViewer, { descriptor })),
  design: () => import('./viewers/DesignViewer').then(({ DesignViewer }) => (descriptor) => h(DesignViewer, { descriptor })),
  font: () => import('./viewers/DesignViewer').then(({ DesignViewer }) => (descriptor) => h(DesignViewer, { descriptor })),
  http: () => import('./viewers/HttpViewer').then(({ HttpViewer }) => (descriptor, host) => {
    if (!host.readText || !host.sendHttp) throw new Error(tPreview('error.httpUnsupported'));
    return h(HttpViewer, {
      descriptor,
      readText: host.readText.bind(host),
      send: host.sendHttp.bind(host),
    });
  }),
  'java-class': () => import('./viewers/JavaClassViewer').then(({ JavaClassViewer }) => (descriptor, host) => {
    if (!host.decompileJava) throw new Error(tPreview('error.javaUnsupported'));
    return h(JavaClassViewer, { descriptor, decompile: host.decompileJava.bind(host) });
  }),
};

export interface PreviewShellProps {
  controller: PreviewController;
}

export function PreviewShell({ controller }: PreviewShellProps): React.ReactElement {
  return React.createElement(SharedPreviewShell, {
    host: controller as PreviewHost,
    assets: getDesktopAssets(),
    extraViewers,
  });
}
