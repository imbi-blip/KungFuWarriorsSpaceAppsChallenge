import type { EarthTrack, TrackId } from '../data/tracks';

interface TrackSidebarProps {
  tracks: EarthTrack[];
  activeTrackId: TrackId;
  customMediaName: string | null;
  onSelectTrack: (trackId: TrackId) => void;
}

export function TrackSidebar({
  tracks,
  activeTrackId,
  customMediaName,
  onSelectTrack,
}: TrackSidebarProps) {
  const activeTrack = tracks.find((t) => t.id === activeTrackId) ?? tracks[0];

  return (
    <aside
      id="datasets-panel"
      aria-label="NASA Earth Information Center Track Selector"
      className="w-full lg:w-[348px] shrink-0 bg-[#0B0F19] border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col"
    >
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h2 className="font-display text-sm font-semibold tracking-wide text-slate-100">
            Earth Science Tracks
          </h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">Keys 1–4</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2" role="group" aria-label="Select Earth dataset track">
          {tracks.map((track) => {
            const isSelected = track.id === activeTrackId && !customMediaName;
            return (
              <button
                key={track.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectTrack(track.id)}
                className={`text-left p-3 rounded-md border transition-colors ${
                  isSelected
                    ? 'bg-[#121B2B] border-cyan-400/70 text-slate-50'
                    : 'bg-[#0E1420] border-slate-800 text-slate-300 hover:border-slate-600 hover:bg-[#111928]'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-sm leading-snug">
                    <span className="font-mono text-xs text-cyan-400 mr-1.5 tabular-nums">
                      0{track.index}.
                    </span>
                    {track.shortTitle}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                    {track.defaultSynthMode === 'pad'
                      ? 'Pad'
                      : track.defaultSynthMode === 'chimes'
                        ? 'Chimes'
                        : 'Pulse'}
                  </span>
                </div>

                <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                  {track.mission} · {track.spatialRes}
                </p>

                <div
                  aria-hidden="true"
                  className="h-1.5 w-full rounded-sm mt-2.5 border border-white/10"
                  style={{ background: track.gradientCss }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Dataset Metadata & Calibrated Color Legend */}
      <div className="p-4 flex-1 flex flex-col gap-4">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-100 leading-snug">
            {customMediaName ? `Custom Frame: ${customMediaName}` : activeTrack.title}
          </h3>
          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
            {customMediaName
              ? 'Sampling real-time pixel brightness, thermal red-channel warmth, and left-to-right spatial balance directly from your uploaded NASA EIC media.'
              : activeTrack.description}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs border-t border-slate-800/90 pt-3">
          <div>
            <dt className="text-slate-400">Mission</dt>
            <dd className="text-slate-100 font-medium mt-0.5 leading-snug">
              {customMediaName ? 'User NASA EIC Upload' : activeTrack.mission}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Instrument</dt>
            <dd className="text-slate-100 font-medium mt-0.5 leading-snug">
              {customMediaName ? 'RGB Pixel Sampler' : activeTrack.sensor}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Cadence</dt>
            <dd className="text-slate-100 font-mono text-[11px] mt-0.5 leading-snug">
              {customMediaName ? 'Uploaded Sequence' : activeTrack.cadence}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Measurement</dt>
            <dd className="text-slate-100 font-mono text-[11px] mt-0.5 leading-snug">
              {customMediaName ? 'Normalized RGB [0–1]' : activeTrack.unit}
            </dd>
          </div>
        </dl>

        {/* Color Legend Scale */}
        <div className="border-t border-slate-800/90 pt-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-slate-200">Color Scale Legend</span>
            <span className="font-mono text-[11px] text-slate-400">{activeTrack.unit}</span>
          </div>
          <div
            className="h-3 w-full rounded-sm border border-slate-700"
            style={{ background: activeTrack.gradientCss }}
            role="img"
            aria-label={`Color gradient legend for ${activeTrack.title}`}
          />
          <div className="grid grid-cols-4 gap-1 mt-2">
            {activeTrack.legendStops.map((stop) => (
              <div key={stop.label} className="min-w-0">
                <div className="font-mono text-[11px] text-slate-100 tabular-nums truncate">
                  {stop.value}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{stop.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">
            {activeTrack.legendExplanation}
          </p>
        </div>
      </div>
    </aside>
  );
}
