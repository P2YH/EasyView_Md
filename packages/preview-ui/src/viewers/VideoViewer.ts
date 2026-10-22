import * as React from 'react';
import { h, type ViewerProps } from './shared';
import { handleMediaKeys, MediaButton, MediaControls, SeekBar, togglePlay, useMediaState } from './mediaControls';
import { tPreview } from '../preview.i18n';

/** While playing, the control bar hides once the pointer leaves the video or rests this long over it. */
const IDLE_HIDE_MS = 2500;

/** The video's own size, shrunk (never enlarged) to fit inside the stage's content box. */
function useFittedFrame(stage: React.RefObject<HTMLDivElement | null>, media: HTMLVideoElement | null): React.CSSProperties | undefined {
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  React.useEffect(() => {
    const element = stage.current;
    if (!element || !media) return undefined;
    const fit = () => {
      if (!media.videoWidth || !media.videoHeight) return;
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const scale = Math.max(0, Math.min(1, width / media.videoWidth, height / media.videoHeight));
      setSize({ width: Math.floor(media.videoWidth * scale), height: Math.floor(media.videoHeight * scale) });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    media.addEventListener('loadedmetadata', fit);
    fit();
    return () => {
      observer.disconnect();
      media.removeEventListener('loadedmetadata', fit);
    };
  }, [stage, media]);
  return size ?? undefined;
}

/** Plays straight from the content URL so the host streams byte ranges instead of loading the whole file. */
export function VideoViewer({ descriptor }: ViewerProps): React.ReactElement {
  const [media, setMedia] = React.useState<HTMLVideoElement | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [pointerActive, setPointerActive] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);
  const idleTimer = React.useRef(0);
  const state = useMediaState(media);
  const frameSize = useFittedFrame(stage, media);
  React.useEffect(() => setFailed(false), [descriptor.contentUrl]);
  React.useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  const wake = () => {
    setPointerActive(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setPointerActive(false), IDLE_HIDE_MS);
  };
  const leave = () => {
    window.clearTimeout(idleTimer.current);
    setPointerActive(false);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen();
  };

  if (failed) {
    return h('div', { className: 'preview-viewer-message preview-viewer-error', role: 'alert' }, tPreview('video.cannotPlay'));
  }
  const controlsVisible = !state.playing || pointerActive;
  return h('div', { ref: stage, className: 'preview-video-viewer' },
    h('div', {
      ref: frame,
      className: `preview-video-frame${controlsVisible ? '' : ' is-idle'}`,
      style: frameSize,
      tabIndex: 0,
      onPointerEnter: wake,
      onPointerMove: wake,
      onPointerLeave: leave,
      onKeyDown: (event: React.KeyboardEvent) => { wake(); handleMediaKeys(event, media); },
    },
      h('video', {
        key: descriptor.contentUrl,
        ref: setMedia,
        src: descriptor.contentUrl,
        preload: 'metadata',
        playsInline: true,
        title: descriptor.fileName,
        onClick: () => togglePlay(media),
        onDoubleClick: toggleFullscreen,
        onError: () => setFailed(true),
      }),
      h('div', { className: 'preview-video-controls', onFocus: wake },
        h(SeekBar, { media, duration: state.duration }),
        h(MediaControls, { media, state },
          document.fullscreenEnabled ? h(MediaButton, { icon: 'fullscreen', label: tPreview('media.fullscreen'), onClick: toggleFullscreen }) : null)),
    ),
  );
}
