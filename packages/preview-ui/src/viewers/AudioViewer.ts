import * as React from 'react';
import type { PreviewDescriptor } from '@easyview/contracts';
import { extension, formatBytes, h, loadingElement, ViewerError, type ViewerProps } from './shared';
import { formatMediaTime, handleMediaKeys, MediaControls, mediaColors, SeekBar, useCanvasLoop, useMediaState } from './mediaControls';
import { tPreview } from '../preview.i18n';

const BAR_COUNT = 48;

/**
 * Loads the file into a same-origin blob URL: Web Audio only exposes samples (and keeps sound) for
 * same-origin media, and the VS Code webview resource origin is cross-origin to the page.
 */
export function AudioViewer({ descriptor }: ViewerProps): React.ReactElement {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  React.useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setUrl(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(descriptor.contentUrl);
        if (!response.ok) throw new Error(tPreview('audio.readFailed', { status: response.status }));
        const bytes = await response.arrayBuffer();
        if (disposed) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: descriptor.mimeType }));
        setUrl(objectUrl);
      } catch (reason) {
        if (!disposed) setError(reason);
      }
    })();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [descriptor.contentUrl, descriptor.mimeType]);
  if (error) return ViewerError({ error });
  if (!url) return loadingElement(tPreview('audio.loading'));
  return h(AudioPlayer, { key: url, descriptor, url });
}

function AudioPlayer({ descriptor, url }: { descriptor: PreviewDescriptor; url: string }): React.ReactElement {
  const [media, setMedia] = React.useState<HTMLAudioElement | null>(null);
  const [failed, setFailed] = React.useState(false);
  const state = useMediaState(media);
  const analyser = React.useRef<AnalyserNode | null>(null);
  React.useEffect(() => {
    if (!media) return undefined;
    let context: AudioContext | null = null;
    // Created on the first play: browsers keep an AudioContext suspended until a user gesture.
    const connect = () => {
      if (!context) {
        context = new AudioContext();
        const node = context.createAnalyser();
        node.fftSize = 1024;
        node.smoothingTimeConstant = 0.75;
        context.createMediaElementSource(media).connect(node);
        node.connect(context.destination);
        analyser.current = node;
      }
      void context.resume();
    };
    media.addEventListener('play', connect);
    return () => {
      media.removeEventListener('play', connect);
      analyser.current = null;
      void context?.close();
    };
  }, [media]);

  const levels = React.useRef(new Float32Array(BAR_COUNT));
  const bins = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const spectrum = useCanvasLoop((context, width, height, canvas) => {
    const node = analyser.current;
    const current = levels.current;
    if (node && media && !media.paused) {
      const data = bins.current ??= new Uint8Array(node.frequencyBinCount);
      node.getByteFrequencyData(data);
      // Log-spaced bands up to ~16 kHz, so bass and treble get comparable room.
      const top = Math.floor(data.length * 0.72);
      for (let bar = 0; bar < BAR_COUNT; bar += 1) {
        const from = Math.floor(top ** (bar / BAR_COUNT));
        const to = Math.max(from + 1, Math.floor(top ** ((bar + 1) / BAR_COUNT)));
        let sum = 0;
        for (let bin = from; bin < to; bin += 1) sum += data[bin];
        current[bar] = Math.max(sum / (to - from) / 255, current[bar] * 0.85);
      }
    } else {
      for (let bar = 0; bar < BAR_COUNT; bar += 1) current[bar] *= 0.9;
    }
    const { accent } = mediaColors(canvas);
    const gap = 4;
    const barWidth = Math.max(1, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT);
    context.fillStyle = accent;
    for (let bar = 0; bar < BAR_COUNT; bar += 1) {
      const barHeight = Math.max(4, current[bar] * (height - 8));
      context.globalAlpha = 0.35 + 0.65 * current[bar];
      context.beginPath();
      context.roundRect(bar * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight, Math.min(barWidth / 2, 3));
      context.fill();
    }
  });

  if (failed) return h('div', { className: 'preview-viewer-message preview-viewer-error', role: 'alert' }, tPreview('audio.cannotPlay'));
  const meta = [extension(descriptor.fileName).slice(1).toUpperCase(), formatBytes(descriptor.size), formatMediaTime(state.duration)];
  return h('div', { className: 'preview-audio-viewer', tabIndex: 0, onKeyDown: (event: React.KeyboardEvent) => handleMediaKeys(event, media) },
    h('div', { className: 'preview-audio-card' },
      h('div', { className: 'preview-audio-header' },
        h('div', { className: 'preview-audio-title', title: descriptor.fileName }, descriptor.fileName),
        h('div', { className: 'preview-audio-meta' }, meta.filter(Boolean).join(' · '))),
      h('canvas', { ref: spectrum, className: 'preview-audio-spectrum', 'aria-hidden': true }),
      h(SeekBar, { media, duration: state.duration }),
      h(MediaControls, { media, state })),
    h('audio', { ref: setMedia, src: url, preload: 'metadata', title: descriptor.fileName, onError: () => setFailed(true) }),
  );
}
