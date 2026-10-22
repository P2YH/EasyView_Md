import * as React from 'react';
import { h } from './shared';
import { tPreview } from '../preview.i18n';

export interface MediaState {
  playing: boolean;
  time: number;
  duration: number;
  muted: boolean;
  volume: number;
}

const MEDIA_EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked'] as const;

export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function useMediaState(media: HTMLMediaElement | null): MediaState {
  const [state, setState] = React.useState<MediaState>({ playing: false, time: 0, duration: 0, muted: false, volume: 1 });
  React.useEffect(() => {
    if (!media) return undefined;
    const sync = () => setState({
      playing: !media.paused && !media.ended,
      time: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration : 0,
      muted: media.muted,
      volume: media.volume,
    });
    for (const name of MEDIA_EVENTS) media.addEventListener(name, sync);
    sync();
    return () => { for (const name of MEDIA_EVENTS) media.removeEventListener(name, sync); };
  }, [media]);
  return state;
}

export function togglePlay(media: HTMLMediaElement | null): void {
  if (!media) return;
  if (media.paused || media.ended) void media.play().catch(() => undefined);
  else media.pause();
}

function seekBy(media: HTMLMediaElement, seconds: number): void {
  if (!Number.isFinite(media.duration)) return;
  media.currentTime = Math.min(media.duration, Math.max(0, media.currentTime + seconds));
}

/** Space / K toggles playback, ← / → seek 5 seconds. Keys typed into the volume slider are left alone. */
export function handleMediaKeys(event: React.KeyboardEvent, media: HTMLMediaElement | null): void {
  if (!media || (event.target as HTMLElement).tagName === 'INPUT') return;
  if (event.key === ' ' || event.key === 'k') togglePlay(media);
  else if (event.key === 'ArrowLeft') seekBy(media, -5);
  else if (event.key === 'ArrowRight') seekBy(media, 5);
  else return;
  event.preventDefault();
}

type IconName = 'play' | 'pause' | 'volume' | 'muted' | 'fullscreen';
/** Each path: [d, filled]. Filled shapes use currentColor, the rest are 1.8px strokes. */
const ICONS: Record<IconName, ReadonlyArray<readonly [string, boolean]>> = {
  play: [['M8 5.5v13l10.5-6.5z', true]],
  pause: [['M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', true]],
  volume: [['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', true], ['M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18 6.3a8 8 0 0 1 0 11.4', false]],
  muted: [['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', true], ['M15.5 9.5l5 5M20.5 9.5l-5 5', false]],
  fullscreen: [['M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', false]],
};

export function MediaIcon({ name }: { name: IconName }): React.ReactElement {
  return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true, className: 'preview-media-icon' },
    ...ICONS[name].map(([d, filled], index) => h('path', {
      key: index,
      d,
      fill: filled ? 'currentColor' : 'none',
      stroke: filled ? 'none' : 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })));
}

export function MediaButton({ icon, label, className, onClick }: { icon: IconName; label: string; className?: string; onClick: () => void }): React.ReactElement {
  return h('button', { type: 'button', className: `preview-media-button${className ? ` ${className}` : ''}`, title: label, 'aria-label': label, onClick },
    h(MediaIcon, { name: icon }));
}

/** Redraws a HiDPI canvas every animation frame; `draw` always sees the latest props. */
export function useCanvasLoop(
  draw: (context: CanvasRenderingContext2D, width: number, height: number, canvas: HTMLCanvasElement) => void,
): React.RefObject<HTMLCanvasElement | null> {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawRef = React.useRef(draw);
  drawRef.current = draw;
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;
    let frame = 0;
    const tick = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.globalAlpha = 1;
      drawRef.current(context, width, height, canvas);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return canvasRef;
}

/** Canvas colours come from CSS: `--preview-media-accent` and the element's text colour. */
export function mediaColors(canvas: HTMLCanvasElement): { accent: string; foreground: string } {
  const style = getComputedStyle(canvas);
  return { accent: style.getPropertyValue('--preview-media-accent').trim() || '#408fff', foreground: style.color };
}

export function SeekBar({ media, duration }: { media: HTMLMediaElement | null; duration: number }): React.ReactElement {
  const canvasRef = useCanvasLoop((context, width, height, canvas) => {
    const progress = media && duration > 0 ? Math.min(1, media.currentTime / duration) : 0;
    const { accent, foreground } = mediaColors(canvas);
    const middle = height / 2;
    context.fillStyle = foreground;
    context.globalAlpha = 0.3;
    context.beginPath();
    context.roundRect(0, middle - 2, width, 4, 2);
    context.fill();
    context.globalAlpha = 1;
    context.fillStyle = accent;
    context.beginPath();
    context.roundRect(0, middle - 2, width * progress, 4, 2);
    context.fill();
    context.beginPath();
    context.arc(Math.min(width - 6, Math.max(6, width * progress)), middle, 6, 0, Math.PI * 2);
    context.fill();
  });
  const dragging = React.useRef(false);
  const seek = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!media || duration <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    media.currentTime = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration;
  };
  return h('canvas', {
    ref: canvasRef,
    className: 'preview-media-seek',
    role: 'slider',
    tabIndex: 0,
    'aria-label': tPreview('media.seek'),
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(duration),
    'aria-valuenow': Math.round(media?.currentTime ?? 0),
    'aria-valuetext': formatMediaTime(media?.currentTime ?? 0),
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); seek(event); },
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => { if (dragging.current) seek(event); },
    onPointerUp: () => { dragging.current = false; },
    onPointerCancel: () => { dragging.current = false; },
  });
}

/** Play / time / mute / volume row shared by the audio and video players; `children` go at the end. */
export function MediaControls({ media, state, children }: { media: HTMLMediaElement | null; state: MediaState; children?: React.ReactNode }): React.ReactElement {
  const silent = state.muted || state.volume === 0;
  return h('div', { className: 'preview-media-controls' },
    h(MediaButton, {
      icon: state.playing ? 'pause' : 'play',
      label: tPreview(state.playing ? 'media.pause' : 'media.play'),
      className: 'preview-media-play',
      onClick: () => togglePlay(media),
    }),
    h('span', { className: 'preview-media-time' }, `${formatMediaTime(state.time)} / ${formatMediaTime(state.duration)}`),
    h(MediaButton, {
      icon: silent ? 'muted' : 'volume',
      label: tPreview(silent ? 'media.unmute' : 'media.mute'),
      onClick: () => {
        if (!media) return;
        if (silent && media.volume === 0) media.volume = 1;
        media.muted = !silent;
      },
    }),
    h('input', {
      type: 'range',
      className: 'preview-media-volume',
      min: 0,
      max: 1,
      step: 0.05,
      value: silent ? 0 : state.volume,
      style: { '--preview-media-level': `${(silent ? 0 : state.volume) * 100}%` } as React.CSSProperties,
      'aria-label': tPreview('media.volume'),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!media) return;
        media.volume = Number(event.target.value);
        media.muted = media.volume === 0;
      },
    }),
    children,
  );
}
