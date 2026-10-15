import * as React from 'react';
import { DrawioViewer } from './DrawioViewer';
import { extension, h, UniversalFilePreview, type ViewerProps } from './shared';
import { tPreview } from '../preview.i18n';

export function DesignViewer({ descriptor }: ViewerProps): React.ReactElement {
  const suffix = extension(descriptor.fileName);
  if (suffix === '.drawio' || suffix === '.dio') {
    return h(DrawioViewer, { descriptor });
  }
  return h(UniversalFilePreview, {
    descriptor,
    loadingLabel: tPreview('design.loading', { format: suffix.slice(1).toUpperCase() || tPreview('design.defaultFormat') }),
  });
}
