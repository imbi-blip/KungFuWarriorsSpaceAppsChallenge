import { useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { SynthMode } from '../data/tracks';
import type { EarthAudioEngine } from '../audio/EarthAudioEngine';
import { formatPanLabel, type PixelTelemetry } from '../utils/sonificationMath';

interface SonificationPanelProps {
  synthMode: SynthMode;
  minFreq: number;
  maxFreq: number;
  volume: number;
  isMuted: boolean;
  isPlaying: boolean;
  telemetry: PixelTelemetry;
  audioEngine: EarthAudioEngine;
  onChangeMode: (mode: SynthMode) => void;
  onChangeFreqRange: (minFreq: number, maxFreq: number) => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
}

const SYNTH_MODES: Array<{ id: SynthMode; label: string }> = [
  { id: 'pad', label: 'Ambient Pad' },
  { id: 'chimes', label: 'Harmonic Chimes' },
  { id: 'pulse', label: 'Pulse Synth' },
];

export function SonificationPanel({
  synthMode,
  minFreq,
  maxFreq,
  volume,
  isMuted,
  isPlaying,
  telemetry,
  audioEngine,
  onChangeMode,
  onChangeFreqRange,
  onChangeVolume,
  onToggleMute,
}: SonificationPanelProps) {
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const telemetryRef = useRef(telemetry);
  const playingRef = useRef(isPlaying);
  const mutedRef = useRef(isMuted);

  telemetryRef.current = telemetry;
  playingRef.current = isPlaying;
  mutedRef.current = isMuted;

  useEffect(() => {
    let rafId = 0;
    const draw = (nowMs: number) => {
      const canvas = spectrumCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#07090E';
        ctx.fillRect(0, 0, w, h);

        // Subtle horizontal center reference line
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.5);
        ctx.lineTo(w, h * 0.5);
        ctx.stroke();

        const analyser = audioEngine.getAnalyserData();
        const t = telemetryRef.current;

        // Draw FFT Frequency Spectrum Bars
        const barCount = 36;
        const barW = w / barCount;
        for (let i = 0; i < barCount; i++) {
          let mag = 0;
          if (analyser && playingRef.current && !mutedRef.current) {
            const binIdx = Math.min(analyser.frequency.length - 1, Math.floor(i * 1.4));
            mag = analyser.frequency[binIdx] / 255;
          } else {
            // Deterministic harmonic spectral preview mapped to active pixel telemetry
            const centerBin = Math.min(barCount - 1, (t.pitchHz / 1200) * barCount);
            const dist = Math.abs(i - centerBin);
            const cutoffFade = i < (t.filterCutoffHz / 3800) * barCount ? 1 : 0.22;
            const ripple = 0.5 + 0.5 * Math.sin(nowMs * 0.004 + i * 0.45);
            mag = Math.exp(-(dist * dist) / 36) * (0.35 + t.dataDensity * 0.65) * cutoffFade * (0.7 + 0.3 * ripple);
          }

          const barH = Math.max(2, mag * (h * 0.78));
          const x = i * barW + 1;
          const y = h - barH;
          ctx.fillStyle = mag > 0.6 ? 'rgba(34, 211, 238, 0.72)' : 'rgba(6, 182, 212, 0.34)';
          ctx.fillRect(x, y, Math.max(2, barW - 2), barH);
        }

        // Draw Time-Domain Oscilloscope Waveform overlay
        ctx.strokeStyle = playingRef.current && !mutedRef.current ? '#67e8f9' : '#38bdf8';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        if (analyser && playingRef.current && !mutedRef.current) {
          const len = analyser.timeDomain.length;
          for (let i = 0; i < len; i++) {
            const v = analyser.timeDomain[i] / 128.0 - 1.0;
            const x = (i / (len - 1)) * w;
            const y = h * 0.48 + v * (h * 0.36);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        } else {
          const freqRatio = t.pitchHz / 220;
          const amp = (0.12 + t.mappedGain * 0.25) * h;
          for (let x = 0; x <= w; x += 4) {
            const norm = x / w;
            const wave =
              Math.sin(norm * Math.PI * 4 * freqRatio + nowMs * 0.004) *
              Math.sin(norm * Math.PI);
            const y = h * 0.48 + wave * amp;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [audioEngine]);

  return (
    <section
      id="sonification-panel"
      aria-label="Sonification Mapping Controls and Live Spectrum"
      className="bg-[#0B0F19] border border-slate-800 rounded-lg p-3.5 flex flex-col gap-3 flex-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-100">
          Sonification Engine & Spectrum
        </h2>

        {/* Synth Mode Selector */}
        <div
          className="inline-flex items-center gap-1 p-0.5 bg-[#07090E] border border-slate-800 rounded-md"
          role="group"
          aria-label="Synthesizer timbre mode"
        >
          {SYNTH_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={synthMode === m.id}
              onClick={() => onChangeMode(m.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                synthMode === m.id
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                  : 'text-slate-400 hover:text-slate-100 border border-transparent'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live Waveform & Spectrum Canvas */}
      <div className="rounded-md overflow-hidden border border-slate-800 bg-[#07090E]">
        <canvas
          ref={spectrumCanvasRef}
          width={560}
          height={82}
          data-testid="audio-spectrum-canvas"
          aria-label="Real-time audio waveform and frequency spectrum visualizer"
          className="w-full h-[82px] block"
        />
      </div>

      {/* Real-time Acoustic Telemetry Readouts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1 border-y border-slate-800/80">
        <div>
          <div className="text-[11px] text-slate-400">Quantized Pitch</div>
          <div className="font-mono text-sm font-semibold text-slate-50 tabular-nums mt-0.5">
            {telemetry.noteName} · {Math.round(telemetry.pitchHz)} Hz
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">Stereo Pan</div>
          <div className="font-mono text-sm font-semibold text-cyan-300 tabular-nums mt-0.5">
            {formatPanLabel(telemetry.stereoPan)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">Data Density</div>
          <div className="font-mono text-sm font-semibold text-slate-50 tabular-nums mt-0.5">
            {(telemetry.dataDensity * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">Filter Cutoff</div>
          <div className="font-mono text-sm font-semibold text-slate-50 tabular-nums mt-0.5">
            {telemetry.filterCutoffHz.toLocaleString()} Hz
          </div>
        </div>
      </div>

      {/* Frequency Range & Gain Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <label htmlFor="min-freq-slider" className="text-slate-300">
              Min Frequency
            </label>
            <span className="font-mono text-xs text-slate-200 tabular-nums">{Math.round(minFreq)} Hz</span>
          </div>
          <input
            id="min-freq-slider"
            type="range"
            min={80}
            max={340}
            step={2}
            value={minFreq}
            onChange={(e) => {
              const nextMin = Number(e.target.value);
              onChangeFreqRange(nextMin, Math.max(nextMin + 120, maxFreq));
            }}
            className="telemetry-slider w-full"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <label htmlFor="max-freq-slider" className="text-slate-300">
              Max Frequency
            </label>
            <span className="font-mono text-xs text-slate-200 tabular-nums">{Math.round(maxFreq)} Hz</span>
          </div>
          <input
            id="max-freq-slider"
            type="range"
            min={420}
            max={1400}
            step={10}
            value={maxFreq}
            onChange={(e) => {
              const nextMax = Number(e.target.value);
              onChangeFreqRange(Math.min(minFreq, nextMax - 120), nextMax);
            }}
            className="telemetry-slider w-full"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute audio output' : 'Mute audio output'}
            className={`inline-flex items-center justify-center p-2 rounded-md border transition-colors shrink-0 min-h-[36px] min-w-[36px] ${
              isMuted
                ? 'bg-rose-950/50 border-rose-500/50 text-rose-200'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-cyan-400/70'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs mb-1">
              <label htmlFor="master-volume-slider" className="text-slate-300">
                Gain
              </label>
              <span className="font-mono text-xs text-slate-200 tabular-nums">
                {isMuted ? 'Muted' : `${Math.round(volume * 100)}%`}
              </span>
            </div>
            <input
              id="master-volume-slider"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(e) => onChangeVolume(Number(e.target.value))}
              className="telemetry-slider w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
