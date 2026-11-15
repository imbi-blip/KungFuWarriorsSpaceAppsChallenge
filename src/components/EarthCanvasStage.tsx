import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Crosshair, Pause, Play, RotateCcw, ShieldAlert, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import type { EarthTrack, SynthMode } from '../data/tracks';
import type { LiveEvent } from '../../shared/types';
import { ProceduralEarthRenderer } from '../utils/proceduralEarth';
import {
  clampViewport,
  DEFAULT_VIEWPORT,
  interpolateViewport,
  screenToLonLat,
  type MapViewport,
} from '../utils/mapProjection';
import {
  analyzeRgbaFrame,
  coordsToLatLon,
  formatTimestamp,
  type PixelTelemetry,
} from '../utils/sonificationMath';

export interface CustomMediaSource {
  kind: 'image' | 'video' | 'sequence';
  name: string;
  urls: string[];
  duration: number;
}

interface EarthCanvasStageProps {
  track: EarthTrack;
  isPlaying: boolean;
  currentTime: number;
  speed: number;
  synthMode: SynthMode;
  minFreq: number;
  maxFreq: number;
  customMedia: CustomMediaSource | null;
  viewport: MapViewport;
  showRiskOverlay: boolean;
  selectedPoint: { lon: number; lat: number } | null;
  liveEvents: LiveEvent[];
  onTogglePlay: () => void;
  onSeek: (timeSec: number) => void;
  onAdvanceTime: (deltaSec: number, durationSec: number) => void;
  onSpeedChange: (speed: number) => void;
  onTelemetrySample: (telemetry: PixelTelemetry, nowMs: number) => void;
  onUploadMedia: (media: CustomMediaSource) => void;
  onClearCustomMedia: () => void;
  onMapInspect: (lon: number, lat: number) => void;
  onChangeViewport: (nextViewport: MapViewport) => void;
  onToggleRiskOverlay: () => void;
  canvasRefOut: React.RefObject<HTMLCanvasElement | null>;
}

const CANVAS_W = 960;
const CANVAS_H = 480;
const SPEED_OPTIONS = [0.5, 1, 1.5, 2];

export function EarthCanvasStage({
  track,
  isPlaying,
  currentTime,
  speed,
  minFreq,
  maxFreq,
  customMedia,
  viewport,
  showRiskOverlay,
  selectedPoint,
  liveEvents,
  onTogglePlay,
  onSeek,
  onAdvanceTime,
  onSpeedChange,
  onTelemetrySample,
  onUploadMedia,
  onClearCustomMedia,
  onMapInspect,
  onChangeViewport,
  onToggleRiskOverlay,
  canvasRefOut,
}: EarthCanvasStageProps) {
  const rendererRef = useRef<ProceduralEarthRenderer | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImagesRef = useRef<HTMLImageElement[]>([]);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const displayViewportRef = useRef<MapViewport>(viewport);

  const [hoverCoords, setHoverCoords] = useState<{ latLabel: string; lonLabel: string } | null>(
    null,
  );
  const [mediaDuration, setMediaDuration] = useState<number>(track.durationSeconds);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const stateRef = useRef({
    track,
    isPlaying,
    currentTime,
    speed,
    minFreq,
    maxFreq,
    customMedia,
    mediaDuration,
    viewport,
    showRiskOverlay,
    selectedPoint,
    liveEvents,
  });
  stateRef.current = {
    track,
    isPlaying,
    currentTime,
    speed,
    minFreq,
    maxFreq,
    customMedia,
    mediaDuration,
    viewport,
    showRiskOverlay,
    selectedPoint,
    liveEvents,
  };

  const callbacksRef = useRef({ onAdvanceTime, onTelemetrySample, onSeek });
  callbacksRef.current = { onAdvanceTime, onTelemetrySample, onSeek };

  useEffect(() => {
    rendererRef.current = new ProceduralEarthRenderer();
    const sc = document.createElement('canvas');
    sc.width = 64;
    sc.height = 32;
    sampleCanvasRef.current = sc;
  }, []);

  useEffect(() => {
    loadedImagesRef.current = [];
    if (videoElRef.current) {
      videoElRef.current.pause();
      videoElRef.current.removeAttribute('src');
      videoElRef.current = null;
    }

    if (!customMedia) {
      setMediaDuration(track.durationSeconds);
      return;
    }

    if (customMedia.kind === 'video') {
      const video = document.createElement('video');
      video.src = customMedia.urls[0];
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.addEventListener('loadedmetadata', () => {
        const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 15;
        setMediaDuration(dur);
      });
      video.addEventListener('error', () => {
        setUploadError('Could not decode uploaded video format in this browser.');
      });
      videoElRef.current = video;
    } else {
      const imgs = customMedia.urls.map((url) => {
        const img = new Image();
        img.src = url;
        return img;
      });
      loadedImagesRef.current = imgs;
      setMediaDuration(customMedia.kind === 'sequence' ? Math.max(4, imgs.length * 0.5) : 30);
    }
  }, [customMedia, track.durationSeconds]);

  useEffect(() => {
    const video = videoElRef.current;
    if (!video || !customMedia || customMedia.kind !== 'video') return;
    video.playbackRate = speed;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, speed, customMedia]);

  const handleScrub = (nextSec: number) => {
    if (videoElRef.current && customMedia?.kind === 'video') {
      videoElRef.current.currentTime = nextSec;
    }
    onSeek(nextSec);
  };

  useEffect(() => {
    let rafId = 0;
    let lastFrameMs = performance.now();
    let lastTelemetryMs = 0;

    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.1, Math.max(0, (nowMs - lastFrameMs) / 1000));
      lastFrameMs = nowMs;

      const s = stateRef.current;
      const activeDur = s.customMedia ? s.mediaDuration : s.track.durationSeconds;

      // Smoothly interpolate displayed map zoom & center toward target viewport
      const targetVp = s.viewport;
      const curVp = displayViewportRef.current;
      if (
        Math.abs(curVp.zoom - targetVp.zoom) > 0.005 ||
        Math.abs(curVp.centerLon - targetVp.centerLon) > 0.05 ||
        Math.abs(curVp.centerLat - targetVp.centerLat) > 0.05
      ) {
        displayViewportRef.current = interpolateViewport(curVp, targetVp, 0.24);
      } else {
        displayViewportRef.current = targetVp;
      }

      if (s.isPlaying) {
        if (s.customMedia?.kind === 'video' && videoElRef.current && !videoElRef.current.paused) {
          callbacksRef.current.onSeek(videoElRef.current.currentTime);
        } else {
          callbacksRef.current.onAdvanceTime(dtSec * s.speed, activeDur);
        }
      }

      const canvas = canvasRefOut.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        if (s.customMedia) {
          ctx.fillStyle = '#07090E';
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

          if (s.customMedia.kind === 'video' && videoElRef.current) {
            const v = videoElRef.current;
            if (v.readyState >= 2) {
              ctx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
            }
          } else if (loadedImagesRef.current.length > 0) {
            const imgs = loadedImagesRef.current;
            const frameIdx =
              imgs.length === 1
                ? 0
                : Math.min(
                    imgs.length - 1,
                    Math.floor((s.currentTime / Math.max(0.1, activeDur)) * imgs.length),
                  );
            const img = imgs[frameIdx];
            if (img && img.complete && img.naturalWidth > 0) {
              const scale = Math.min(CANVAS_W / img.naturalWidth, CANVAS_H / img.naturalHeight);
              const dw = img.naturalWidth * scale;
              const dh = img.naturalHeight * scale;
              ctx.drawImage(img, (CANVAS_W - dw) / 2, (CANVAS_H - dh) / 2, dw, dh);
            }
          }
        } else if (rendererRef.current) {
          rendererRef.current.render(
            ctx,
            CANVAS_W,
            CANVAS_H,
            s.track.id,
            s.currentTime,
            s.track.durationSeconds,
            {
              viewport: displayViewportRef.current,
              showRiskOverlay: s.showRiskOverlay,
              selectedPoint: s.selectedPoint,
              liveEvents: s.liveEvents,
            },
          );
        }

        if (nowMs - lastTelemetryMs >= 66 && sampleCanvasRef.current) {
          lastTelemetryMs = nowMs;
          const sctx = sampleCanvasRef.current.getContext('2d', { willReadFrequently: true });
          if (sctx) {
            sctx.drawImage(canvas, 0, 0, 64, 32);
            const imgData = sctx.getImageData(0, 0, 64, 32);
            const telemetry = analyzeRgbaFrame(imgData.data, 64, 32, {
              scaleType: s.track.scaleType,
              minFreq: s.minFreq,
              maxFreq: s.maxFreq,
              sampleStride: 1,
            });
            callbacksRef.current.onTelemetrySample(telemetry, nowMs);
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRefOut]);

  const handleCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRefOut.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (ev.clientX - rect.left) / Math.max(1, rect.width);
    const ny = (ev.clientY - rect.top) / Math.max(1, rect.height);

    const { lon, lat } = screenToLonLat(nx, ny, displayViewportRef.current);
    onMapInspect(lon, lat);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const first = fileList[0];

    if (first.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(first.name)) {
      const url = URL.createObjectURL(first);
      onUploadMedia({
        kind: 'video',
        name: first.name,
        urls: [url],
        duration: 15,
      });
    } else if (
      fileList.every((f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name))
    ) {
      const urls = fileList.map((f) => URL.createObjectURL(f));
      onUploadMedia({
        kind: fileList.length > 1 ? 'sequence' : 'image',
        name: fileList.length > 1 ? `${fileList.length} NASA EIC Frames` : first.name,
        urls,
        duration: fileList.length > 1 ? Math.max(4, fileList.length * 0.5) : 30,
      });
    } else {
      setUploadError('Unsupported file type. Upload .mp4, .webm, .gif, .png, or .jpg frames.');
    }

    e.target.value = '';
  };

  const activeDuration = customMedia ? mediaDuration : track.durationSeconds;

  return (
    <section
      id="canvas-stage"
      aria-label="Interactive Earth Visualization and Frame Scrubber"
      className="bg-[#0B0F19] border border-slate-800 rounded-lg overflow-hidden"
    >
      {/* Equirectangular 2:1 Canvas Frame */}
      <div className="relative bg-[#05080E] aspect-[2/1] lg:aspect-auto lg:h-[385px] w-full flex items-center justify-center">
        <canvas
          ref={canvasRefOut}
          width={CANVAS_W}
          height={CANVAS_H}
          data-testid="earth-canvas"
          aria-label={`Interactive Earth map for ${customMedia ? customMedia.name : track.title}. Click any region to assess wildfire, flood and tsunami risk for the next 20 days.`}
          className="w-full h-full lg:w-auto lg:max-w-full lg:aspect-[2/1] block cursor-crosshair"
          onClick={handleCanvasClick}
          onMouseMove={(ev) => {
            const rect = ev.currentTarget.getBoundingClientRect();
            const nx = (ev.clientX - rect.left) / Math.max(1, rect.width);
            const ny = (ev.clientY - rect.top) / Math.max(1, rect.height);
            const { lon, lat } = screenToLonLat(nx, ny, displayViewportRef.current);
            const mapNormX = (lon + 180) / 360;
            const mapNormY = (90 - lat) / 180;
            setHoverCoords(coordsToLatLon(mapNormX, mapNormY));
          }}
          onMouseLeave={() => setHoverCoords(null)}
        />

        {/* Top-left coordinate/projection & instruction caption */}
        <div className="pointer-events-none absolute top-2.5 left-3 flex items-center gap-2 bg-[#07090E]/88 border border-slate-800 px-2.5 py-1 rounded text-xs font-mono text-slate-200 tabular-nums">
          <span>
            {customMedia
              ? customMedia.name
              : `${track.shortTitle} · ${viewport.zoom > 1.05 ? `${viewport.zoom.toFixed(1)}× Zoom` : 'Click map to assess 20-day risk'}`}
          </span>
        </div>

        {/* Top-right Map Zoom & Risk Layer Overlay Controls */}
        {!customMedia && (
          <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={showRiskOverlay}
              onClick={onToggleRiskOverlay}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                showRiskOverlay
                  ? 'bg-rose-950/85 border-rose-400/70 text-rose-100'
                  : 'bg-[#07090E]/88 border-slate-700 text-slate-200 hover:border-cyan-400/70'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
              <span>Live Events</span>
            </button>

            <button
              type="button"
              aria-label="Zoom in map"
              onClick={() =>
                onChangeViewport(
                  clampViewport({ ...viewport, zoom: Math.min(5, viewport.zoom + 0.8) }),
                )
              }
              className="p-1.5 rounded bg-[#07090E]/88 border border-slate-700 text-slate-200 hover:border-cyan-400/70 transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-label="Zoom out map"
              disabled={viewport.zoom <= 1.05}
              onClick={() =>
                onChangeViewport(
                  clampViewport({ ...viewport, zoom: Math.max(1, viewport.zoom - 0.8) }),
                )
              }
              className="p-1.5 rounded bg-[#07090E]/88 border border-slate-700 text-slate-200 hover:border-cyan-400/70 disabled:opacity-40 transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {viewport.zoom > 1.05 && (
              <button
                type="button"
                aria-label="Reset map zoom to global view"
                onClick={() => onChangeViewport(DEFAULT_VIEWPORT)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#07090E]/88 border border-cyan-400/60 text-xs font-mono text-cyan-200 hover:bg-slate-900 transition-colors"
              >
                <Crosshair className="w-3 h-3" aria-hidden="true" />
                <span>1×</span>
              </button>
            )}
          </div>
        )}

        {/* Bottom-right cursor Lat/Lon crosshair readout */}
        {hoverCoords && (
          <div className="pointer-events-none absolute bottom-2.5 right-3 bg-[#07090E]/90 border border-slate-700 px-2.5 py-1 rounded text-xs font-mono text-cyan-300 tabular-nums">
            {hoverCoords.latLabel} · {hoverCoords.lonLabel}
          </div>
        )}
      </div>

      {/* Transport & Timeline Scrubber Bar */}
      <div className="p-3 sm:px-4 bg-[#0D1320] border-t border-slate-800 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause visualization and audio' : 'Play visualization and audio'}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          {isPlaying ? (
            <>
              <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              <span>Play</span>
            </>
          )}
        </button>

        {/* Timeline Scrubber */}
        <div className="flex-1 min-w-[180px] flex items-center gap-3">
          <label htmlFor="timeline-scrubber" className="sr-only">
            Timeline scrubber
          </label>
          <input
            id="timeline-scrubber"
            type="range"
            min={0}
            max={activeDuration}
            step={0.1}
            value={Math.min(activeDuration, currentTime)}
            onChange={(e) => handleScrub(Number(e.target.value))}
            className="telemetry-slider w-full"
          />
          <span className="font-mono text-xs text-slate-200 tabular-nums whitespace-nowrap shrink-0">
            {formatTimestamp(currentTime)} / {formatTimestamp(activeDuration)}
          </span>
        </div>

        {/* Playback Speed Selector */}
        <div
          className="flex items-center gap-1 bg-[#07090E] border border-slate-800 rounded-md p-0.5 shrink-0"
          role="group"
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={speed === opt}
              onClick={() => onSpeedChange(opt)}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                speed === opt
                  ? 'bg-slate-800 text-cyan-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {opt}x
            </button>
          ))}
        </div>

        {/* Upload NASA EIC Frame / Video */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,video/mp4,video/webm"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-100 bg-slate-900 border border-slate-700 rounded-md hover:border-cyan-400/70 hover:text-cyan-200 transition-colors whitespace-nowrap min-h-[40px]"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
            <span>Upload NASA EIC Frame / Video</span>
          </button>

          {customMedia && (
            <button
              type="button"
              onClick={onClearCustomMedia}
              aria-label="Return to preloaded Earth track"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-200 bg-slate-900 border border-amber-500/40 rounded-md hover:border-amber-400 transition-colors whitespace-nowrap min-h-[40px]"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset Track</span>
            </button>
          )}
        </div>
      </div>

      {uploadError && (
        <div
          role="alert"
          className="px-4 py-2 text-xs text-rose-300 bg-rose-950/40 border-t border-rose-800/60"
        >
          {uploadError}
        </div>
      )}
    </section>
  );
}
