import * as React from 'react';
import { extension, h, UniversalFilePreview, type ViewerProps } from './shared';
import { tPreview } from '../preview.i18n';

/**
 * Shared UniversalFilePreview routes: design (XMind/PSD), epub, and font.
 * Host-specific formats like drawio stay in desktop extraViewers.
 */
export function DesignViewer({ descriptor }: ViewerProps): React.ReactElement {
  const suffix = extension(descriptor.fileName);
  const label = suffix === '.xmind'
    ? tPreview('design.loadingXmind')
    : tPreview('design.loadingFormat', { format: suffix.slice(1).toUpperCase() || tPreview('design.genericFormat') });
  return h(UniversalFilePreview, { descriptor, loadingLabel: label });
}
