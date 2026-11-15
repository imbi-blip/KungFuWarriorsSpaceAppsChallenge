import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EARTH_TRACKS, type SynthMode, type TrackId } from './data/tracks';
import { EarthAudioEngine } from './audio/EarthAudioEngine';
import { formatPanLabel, type PixelTelemetry } from './utils/sonificationMath';
import { clampViewport, DEFAULT_VIEWPORT, type MapViewport } from './utils/mapProjection';
import type { LiveEvent } from '../shared/types';
import { fetchLiveEvents } from './api/riskApi';
import { useLocationRisk } from './hooks/useLocationRisk';
import { Header } from './components/Header';
import { TrackSidebar } from './components/TrackSidebar';
import { EarthCanvasStage, type CustomMediaSource } from './components/EarthCanvasStage';
import { SonificationPanel } from './components/SonificationPanel';
import { AiNarratorPanel } from './components/AiNarratorPanel';
import { RiskReportPanel } from './components/RiskReportPanel';
import { ShortcutsDialog } from './components/ShortcutsDialog';

const INITIAL_TELEMETRY: PixelTelemetry = {
  meanIntensity: 0.24,
  peakIntensity: 0.72,
  thermalIntensity: 0.31,
  dataDensity: 0.34,
  stereoPan: 0,
  centroidX: 0.5,
  centroidY: 0.5,
  pitchHz: 329.63,
  noteName: 'E4',
  filterCutoffHz: 1420,
  mappedGain: 0.5,
};

type AiPanelTab = 'risk' | 'narrator';

export default function App() {
  const [activeTrackId, setActiveTrackId] = useState<TrackId>('wildfires');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);

  const activeTrack = useMemo(
    () => EARTH_TRACKS.find((t) => t.id === activeTrackId) ?? EARTH_TRACKS[0],
    [activeTrackId],
  );

  const [synthMode, setSynthMode] = useState<SynthMode>(activeTrack.defaultSynthMode);
  const [minFreq, setMinFreq] = useState(activeTrack.defaultMinFreq);
  const [maxFreq, setMaxFreq] = useState(activeTrack.defaultMaxFreq);
  const [volume, setVolume] = useState(0.55);
  const [isMuted, setIsMuted] = useState(false);

  const [customMedia, setCustomMedia] = useState<CustomMediaSource | null>(null);
  const [telemetry, setTelemetry] = useState<PixelTelemetry>(INITIAL_TELEMETRY);

  // Interactive Map Zoom & Natural Disaster Risk State
  const [viewport, setViewport] = useState<MapViewport>(DEFAULT_VIEWPORT);
  const [showRiskOverlay, setShowRiskOverlay] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<{ lon: number; lat: number } | null>(null);
  const [activeAiTab, setActiveAiTab] = useState<AiPanelTab>('risk');
  const { state: riskState, load: loadRisk, reset: resetRisk } = useLocationRisk();
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  // Frame Narrator State
  const [narrative, setNarrative] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');

  const earthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioEngineRef = useRef<EarthAudioEngine | null>(null);
  if (!audioEngineRef.current) {
    audioEngineRef.current = new EarthAudioEngine();
  }

  const speechSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  useEffect(() => {
    const engine = audioEngineRef.current;
    return () => {
      engine?.dispose();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (customMedia) {
        customMedia.urls.forEach((u) => URL.revokeObjectURL(u));
      }
    };
  }, [customMedia]);

  const stopSpeech = useCallback(() => {
    if (speechSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [speechSupported]);

  const speakText = useCallback(
    (text: string, rate: number) => {
      if (!speechSupported) return;
      window.speechSynthesis.cancel();
      const plain = text.replace(/\*\*/g, '').replace(/^#+\s+/gm, '');
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.rate = rate;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [speechSupported],
  );

  const refreshLiveEvents = useCallback(() => {
    const ctl = new AbortController();
    fetchLiveEvents(ctl.signal)
      .then(setLiveEvents)
      .catch(() => {
        /* overlay is optional; the map keeps working without it */
      });
    return () => ctl.abort();
  }, []);

  useEffect(() => refreshLiveEvents(), [refreshLiveEvents]);

  const handleMapInspect = useCallback(
    (lon: number, lat: number) => {
      setSelectedPoint({ lon, lat });
      setShowRiskOverlay(true);
      setActiveAiTab('risk');
      setViewport((prev) => clampViewport({ zoom: Math.max(2.8, prev.zoom), centerLon: lon, centerLat: lat }));
      setLiveStatus(`Assessing wildfire, flood and tsunami risk near ${lat.toFixed(1)} degrees latitude, ${lon.toFixed(1)} degrees longitude`);
      void loadRisk(lat, lon);
    },
    [loadRisk],
  );

  const handleUseMyLocation = useCallback(() => {
    setActiveAiTab('risk');
    if (!navigator.geolocation) {
      setLiveStatus('Geolocation is not supported by this browser. Click the map instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setSelectedPoint({ lon: longitude, lat: latitude });
        setShowRiskOverlay(true);
        setViewport(clampViewport({ zoom: 3.2, centerLon: longitude, centerLat: latitude }));
        void loadRisk(latitude, longitude);
      },
      (geoErr) => setLiveStatus(`Location access unavailable: ${geoErr.message}. Click any region on the map instead.`),
      { timeout: 8000 },
    );
  }, [loadRisk]);

  const handleRefreshRisk = useCallback(() => {
    if (selectedPoint) void loadRisk(selectedPoint.lat, selectedPoint.lon);
    refreshLiveEvents();
  }, [selectedPoint, loadRisk, refreshLiveEvents]);

  const handleTogglePlay = useCallback(async () => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    if (!isPlaying) {
      try {
        await engine.start();
        engine.setMode(synthMode);
        engine.setVolume(volume);
        engine.setMuted(isMuted);
      } catch {
        // Visual playback continues even if audio autoplay is blocked
      }
      setIsPlaying(true);
      setLiveStatus(`Playing ${customMedia ? customMedia.name : activeTrack.title}`);
    } else {
      engine.stop();
      setIsPlaying(false);
      setLiveStatus('Playback paused');
    }
  }, [isPlaying, synthMode, volume, isMuted, customMedia, activeTrack.title]);

  const handleSelectTrack = useCallback(
    (trackId: TrackId) => {
      const next = EARTH_TRACKS.find((t) => t.id === trackId);
      if (!next) return;
      setCustomMedia(null);
      setActiveTrackId(trackId);
      setCurrentTime(0);
      setSynthMode(next.defaultSynthMode);
      setMinFreq(next.defaultMinFreq);
      setMaxFreq(next.defaultMaxFreq);
      setNarrative(null);
      setNarrativeError(null);
      stopSpeech();
      audioEngineRef.current?.setMode(next.defaultSynthMode);
      setLiveStatus(`Switched to Track ${next.index}: ${next.title}`);
    },
    [stopSpeech],
  );

  const handleAdvanceTime = useCallback((deltaSec: number, durationSec: number) => {
    setCurrentTime((prev) => {
      const next = prev + deltaSec;
      return next >= durationSec ? next % durationSec : next;
    });
  }, []);

  const handleTelemetrySample = useCallback((nextTelemetry: PixelTelemetry, nowMs: number) => {
    setTelemetry(nextTelemetry);
    audioEngineRef.current?.updateFromTelemetry(nextTelemetry, nowMs);
  }, []);

  const handleChangeMode = useCallback((mode: SynthMode) => {
    setSynthMode(mode);
    audioEngineRef.current?.setMode(mode);
    setLiveStatus(`Sonification synth switched to ${mode}`);
  }, []);

  const handleChangeVolume = useCallback(
    (vol: number) => {
      setVolume(vol);
      audioEngineRef.current?.setVolume(vol);
      if (vol > 0 && isMuted) {
        setIsMuted(false);
        audioEngineRef.current?.setMuted(false);
      }
    },
    [isMuted],
  );

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audioEngineRef.current?.setMuted(next);
      setLiveStatus(next ? 'Audio muted' : 'Audio unmuted');
      return next;
    });
  }, []);

  const handleDescribeFrame = useCallback(async () => {
    const canvas = earthCanvasRef.current;
    if (!canvas || isAnalyzing) return;

    stopSpeech();
    setActiveAiTab('narrator');
    setIsAnalyzing(true);
    setNarrativeError(null);
    setLiveStatus('Analyzing active frame with Gemini AI');

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const telemetrySummary = `Pitch ${telemetry.noteName} (${Math.round(telemetry.pitchHz)} Hz), Stereo Balance ${formatPanLabel(telemetry.stereoPan)}, Active Density ${(telemetry.dataDensity * 100).toFixed(1)}%`;

      const res = await fetch('/api/describe-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType: 'image/jpeg',
          trackTitle: customMedia ? `Uploaded NASA EIC Media: ${customMedia.name}` : activeTrack.title,
          trackDataset: customMedia ? 'Custom User Frame' : `${activeTrack.mission} (${activeTrack.sensor})`,
          telemetrySummary,
        }),
      });

      const payload = (await res.json()) as { narrative?: string; error?: string };
      if (!res.ok || !payload.narrative) {
        throw new Error(payload.error || 'Failed to generate AI frame narrative.');
      }

      setNarrative(payload.narrative);
      setLiveStatus('AI frame narrative ready');
      speakText(payload.narrative, speechRate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to reach AI frame narrator.';
      setNarrativeError(msg);
      setLiveStatus(`Error: ${msg}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, stopSpeech, telemetry, customMedia, activeTrack, speakText, speechRate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutsOpen) {
        if (e.key === 'Escape') {
          setShortcutsOpen(false);
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      if (e.code === 'Space') {
        if (tag !== 'button' && tag !== 'a') {
          e.preventDefault();
          void handleTogglePlay();
        }
      } else if (e.key === '1') {
        handleSelectTrack('wildfires');
      } else if (e.key === '2') {
        handleSelectTrack('co2');
      } else if (e.key === '3') {
        handleSelectTrack('sst');
      } else if (e.key === '4') {
        handleSelectTrack('aerosols');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentTime((t) => Math.max(0, t - 1.5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const dur = customMedia ? customMedia.duration : activeTrack.durationSeconds;
        setCurrentTime((t) => Math.min(dur, t + 1.5));
      } else if (e.key === 'm' || e.key === 'M') {
        handleToggleMute();
      } else if (e.key === 'd' || e.key === 'D') {
        void handleDescribeFrame();
      } else if (e.key === 'r' || e.key === 'R') {
        handleRefreshRisk();
      } else if (e.key === '0') {
        setViewport(DEFAULT_VIEWPORT);
        setSelectedPoint(null);
        resetRisk();
      } else if (e.key === 'Escape') {
        stopSpeech();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    shortcutsOpen,
    handleTogglePlay,
    handleSelectTrack,
    customMedia,
    activeTrack.durationSeconds,
    handleToggleMute,
    handleDescribeFrame,
    handleRefreshRisk,
    resetRisk,
    stopSpeech,
  ]);

  return (
    <div
      id="top"
      data-playing={isPlaying ? 'true' : 'false'}
      data-track={activeTrackId}
      data-zoom={viewport.zoom.toFixed(2)}
      className="min-h-screen bg-[#07090E] text-slate-50 flex flex-col"
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </div>

      <Header onOpenShortcuts={() => setShortcutsOpen(true)} />

      <main className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        <TrackSidebar
          tracks={EARTH_TRACKS}
          activeTrackId={activeTrackId}
          customMediaName={customMedia?.name ?? null}
          onSelectTrack={handleSelectTrack}
        />

        <div className="flex-1 min-w-0 p-3.5 lg:p-4 flex flex-col gap-3.5">
          <EarthCanvasStage
            track={activeTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            speed={speed}
            synthMode={synthMode}
            minFreq={minFreq}
            maxFreq={maxFreq}
            customMedia={customMedia}
            viewport={viewport}
            showRiskOverlay={showRiskOverlay}
            selectedPoint={selectedPoint}
            liveEvents={liveEvents}
            onTogglePlay={() => {
              void handleTogglePlay();
            }}
            onSeek={setCurrentTime}
            onAdvanceTime={handleAdvanceTime}
            onSpeedChange={setSpeed}
            onTelemetrySample={handleTelemetrySample}
            onUploadMedia={(media) => {
              setCustomMedia(media);
              setCurrentTime(0);
              setViewport(DEFAULT_VIEWPORT);
              setSelectedPoint(null);
              resetRisk();
              setNarrative(null);
              setNarrativeError(null);
              stopSpeech();
              setLiveStatus(`Loaded custom NASA EIC media: ${media.name}`);
            }}
            onClearCustomMedia={() => {
              setCustomMedia(null);
              setCurrentTime(0);
              setLiveStatus(`Returned to ${activeTrack.title}`);
            }}
            onMapInspect={handleMapInspect}
            onChangeViewport={(nextVp) => {
              setViewport(nextVp);
              if (nextVp.zoom <= 1.05) {
                setSelectedPoint(null);
                resetRisk();
              }
            }}
            onToggleRiskOverlay={() => setShowRiskOverlay((prev) => !prev)}
            canvasRefOut={earthCanvasRef}
          />

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            <div className="xl:col-span-7 flex flex-col">
              <SonificationPanel
                synthMode={synthMode}
                minFreq={minFreq}
                maxFreq={maxFreq}
                volume={volume}
                isMuted={isMuted}
                isPlaying={isPlaying}
                telemetry={telemetry}
                audioEngine={audioEngineRef.current}
                onChangeMode={handleChangeMode}
                onChangeFreqRange={(minF, maxF) => {
                  setMinFreq(minF);
                  setMaxFreq(maxF);
                }}
                onChangeVolume={handleChangeVolume}
                onToggleMute={handleToggleMute}
              />
            </div>

            <div className="xl:col-span-5 flex flex-col">
              <section
                id="ai-intelligence-panel"
                aria-label="Disaster Prediction and AI Accessibility Narrator"
                className="bg-[#0B0F19] border border-slate-800 rounded-lg p-3.5 flex flex-col gap-3 flex-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-sm font-semibold text-slate-100">
                    {activeAiTab === 'risk' ? '20-Day Hazard Outlook & Safety Agent' : 'AI Accessibility Narrator'}
                  </h2>

                  <div
                    role="tablist"
                    aria-label="AI Intelligence Mode"
                    className="inline-flex items-center gap-1 p-0.5 bg-[#07090E] border border-slate-800 rounded-md"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeAiTab === 'risk'}
                      onClick={() => setActiveAiTab('risk')}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        activeAiTab === 'risk'
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                          : 'text-slate-400 hover:text-slate-100 border border-transparent'
                      }`}
                    >
                      Hazard Outlook
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeAiTab === 'narrator'}
                      onClick={() => setActiveAiTab('narrator')}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        activeAiTab === 'narrator'
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                          : 'text-slate-400 hover:text-slate-100 border border-transparent'
                      }`}
                    >
                      Frame Narrator
                    </button>
                  </div>
                </div>

                {activeAiTab === 'risk' ? (
                  <RiskReportPanel
                    state={riskState}
                    isSpeaking={isSpeaking}
                    speechSupported={speechSupported}
                    onUseMyLocation={handleUseMyLocation}
                    onRefresh={handleRefreshRisk}
                    onSpeak={(text) => speakText(text, speechRate)}
                    onStopSpeech={stopSpeech}
                  />
                ) : (
                  <AiNarratorPanel
                    narrative={narrative}
                    isAnalyzing={isAnalyzing}
                    isSpeaking={isSpeaking}
                    speechRate={speechRate}
                    error={narrativeError}
                    speechSupported={speechSupported}
                    onDescribeFrame={() => {
                      void handleDescribeFrame();
                    }}
                    onSpeakNarrative={() => {
                      if (narrative) speakText(narrative, speechRate);
                    }}
                    onStopSpeech={stopSpeech}
                    onChangeSpeechRate={(nextRate) => {
                      setSpeechRate(nextRate);
                      if (isSpeaking && narrative) {
                        speakText(narrative, nextRate);
                      }
                    }}
                  />
                )}
              </section>
            </div>
          </div>
        </div>
      </main>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
