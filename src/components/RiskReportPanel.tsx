import { useState } from 'react';
import { AlertTriangle, Compass, ExternalLink, Flame, Loader2, MapPin, Phone, ShieldCheck, Sparkles, Square, Volume2, Waves, Droplets } from 'lucide-react';
import type { HazardAssessment, HazardKind } from '../../shared/types';
import { safeHref } from '../api/riskApi';
import type { LocationRiskState } from '../hooks/useLocationRisk';
import { MarkdownText } from './MarkdownText';
import { RiskSparkline, TIER_COLOR } from './RiskSparkline';

interface Props {
  state: LocationRiskState;
  isSpeaking: boolean;
  speechSupported: boolean;
  onUseMyLocation: () => void;
  onRefresh: () => void;
  onSpeak: (text: string) => void;
  onStopSpeech: () => void;
}

type Tab = 'risks' | 'contacts' | 'safety';

const HAZARD_META: Record<HazardKind, { name: string; Icon: typeof Flame }> = {
  wildfire: { name: 'Wildfire', Icon: Flame },
  flood: { name: 'Flood', Icon: Droplets },
  tsunami: { name: 'Tsunami', Icon: Waves },
};

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 underline underline-offset-2">
      <span>{children}</span>
      <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function HazardCard({ h }: { h: HazardAssessment }) {
  const { name, Icon } = HAZARD_META[h.hazard];
  const color = TIER_COLOR[h.tier];
  return (
    <article className="rounded-md bg-[#07090E] border border-slate-800 p-2.5 flex flex-col gap-1.5" aria-label={`${name} risk`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
          <Icon className="w-3.5 h-3.5" style={{ color }} aria-hidden="true" />
          {name}
        </h3>
        {h.available ? (
          <span className="font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap" style={{ color }}>
            ▲ {h.tier} · {h.peakScore}/100
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">Unavailable</span>
        )}
      </header>
      {!h.available ? (
        <p className="text-[11px] text-slate-400 leading-snug">{h.unavailableReason}</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-300 leading-snug">{h.summary}</p>
          <RiskSparkline daily={h.daily} tier={h.tier} label={`${name} risk over the next 20 days. Today ${h.todayScore} out of 100, peak ${h.peakScore} on ${h.peakDate}.`} />
          <div className="flex justify-between text-[10px] font-mono text-slate-500" aria-hidden="true">
            <span>Today</span>
            <span>Peak {fmtDay(h.peakDate)}</span>
            <span>+20 d</span>
          </div>
          {h.tsunami?.officialAlertHint && (
            <p role="alert" className="text-[11px] font-semibold text-rose-200 bg-rose-950/70 border border-rose-500/60 rounded px-2 py-1">
              A large shallow earthquake occurred nearby recently. Check official tsunami warnings now.
            </p>
          )}
          <details className="text-[11px] text-slate-300">
            <summary className="cursor-pointer text-cyan-300">Why this score · data · limits</summary>
            <ul className="mt-1.5 space-y-1">
              {h.drivers.map((d) => (
                <li key={d.label + d.value}>
                  <span className="text-slate-400">{d.label}:</span> {d.value} <span className="text-slate-500">({d.source})</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-slate-400">Confidence: {h.confidence}</p>
            <ul className="mt-1 list-disc pl-4 text-slate-400 space-y-0.5">
              {h.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </article>
  );
}

export function RiskReportPanel({ state, isSpeaking, speechSupported, onUseMyLocation, onRefresh, onSpeak, onStopSpeech }: Props) {
  const [tab, setTab] = useState<Tab>('risks');
  const { report, status, point } = state;
  const coord = point ? `${Math.abs(point.lat).toFixed(2)}° ${point.lat >= 0 ? 'N' : 'S'}, ${Math.abs(point.lon).toFixed(2)}° ${point.lon >= 0 ? 'E' : 'W'}` : 'No location selected';
  const briefText = state.aiBrief ?? report?.briefing.text ?? '';

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-mono text-cyan-300 tabular-nums">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{report?.location.place ?? coord}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={onUseMyLocation} disabled={status === 'loading'} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-900 border border-slate-700 text-slate-100 hover:border-cyan-400/70 disabled:opacity-60 transition-colors whitespace-nowrap">
            <Compass className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
            <span>My Location</span>
          </button>
          {point && (
            <button type="button" onClick={onRefresh} disabled={status === 'loading'} className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-900 border border-slate-700 text-slate-100 hover:border-cyan-400/70 disabled:opacity-60 transition-colors">
              Refresh
            </button>
          )}
          {speechSupported && briefText && (
            <button type="button" onClick={() => (isSpeaking ? onStopSpeech() : onSpeak(briefText))} aria-label={isSpeaking ? 'Stop reading briefing' : 'Read briefing aloud'} className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${isSpeaking ? 'bg-amber-500/20 border-amber-400/60 text-amber-200' : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-cyan-400/70'}`}>
              {isSpeaking ? <Square className="w-3 h-3 fill-current" aria-hidden="true" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />}
              <span>{isSpeaking ? 'Stop' : 'Speak'}</span>
            </button>
          )}
        </div>
      </div>

      {status === 'idle' && (
        <p className="text-xs text-slate-400 leading-relaxed rounded-md bg-[#07090E] border border-slate-800 p-3">
          Click anywhere on the map to get a 20-day outlook for <strong className="text-slate-200">wildfire, flood and tsunami</strong> risk at that spot, built from NASA POWER, FIRMS and EONET data, plus local emergency contacts and safety steps.
        </p>
      )}
      {status === 'loading' && (
        <div role="status" className="flex items-center gap-2 text-xs text-cyan-300 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Gathering NASA, weather and earthquake data for {coord}…</span>
        </div>
      )}
      {status === 'error' && (
        <p role="alert" className="text-xs text-rose-300 rounded-md bg-[#07090E] border border-rose-900 p-3">
          {state.error}
        </p>
      )}

      {status === 'ready' && report && (
        <>
          <div className="rounded-md border px-2.5 py-1.5 text-xs flex items-start gap-2" style={{ borderColor: TIER_COLOR[report.overallTier] }} role="note">
            <Phone className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-300" aria-hidden="true" />
            <span className="text-slate-200">
              <strong>In danger now? Call {report.safety.emergencyNumbers.slice(0, 2).map((n) => n.number).join(' or ')}.</strong>{' '}
              <span className="text-slate-400">Overall outlook: {report.overallTier}.</span>
            </span>
          </div>

          <div role="tablist" aria-label="Report sections" className="inline-flex self-start items-center gap-1 p-0.5 bg-[#07090E] border border-slate-800 rounded-md">
            {([['risks', 'Risks'], ['contacts', 'Local authorities'], ['safety', 'Stay safe']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${tab === id ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50' : 'text-slate-400 hover:text-slate-100 border border-transparent'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="max-h-[360px] overflow-y-auto pr-0.5 flex flex-col gap-2.5" aria-live="polite">
            {tab === 'risks' && (
              <>
                <section aria-label="Briefing" className="rounded-md bg-[#07090E] border border-slate-800 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1.5">
                    {state.aiBrief ? <Sparkles className="w-3 h-3 text-cyan-300" aria-hidden="true" /> : <ShieldCheck className="w-3 h-3 text-cyan-300" aria-hidden="true" />}
                    <span>{state.aiBrief ? 'AI briefing (grounded in the data below)' : 'Briefing'}</span>
                    {state.aiStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin" aria-label="AI briefing loading" />}
                  </div>
                  <MarkdownText markdown={briefText} />
                </section>
                {report.hazards.map((h) => (
                  <HazardCard key={h.hazard} h={h} />
                ))}
                {report.nearbyEvents.length > 0 && (
                  <section aria-label="Nearby live events" className="rounded-md bg-[#07090E] border border-slate-800 p-2.5">
                    <h3 className="text-xs font-semibold text-slate-100 mb-1">Reported nearby (NASA EONET, last 20 days)</h3>
                    <ul className="text-[11px] text-slate-300 space-y-0.5">
                      {report.nearbyEvents.slice(0, 5).map((e) => (
                        <li key={e.id}>
                          <ExtLink href={e.url ?? ''}>{e.title}</ExtLink> <span className="text-slate-500">· {e.category} · {e.distanceKm} km</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <details className="text-[11px] text-slate-400">
                  <summary className="cursor-pointer text-cyan-300">Data sources</summary>
                  <ul className="mt-1 space-y-0.5">
                    {report.dataSources.map((s) => (
                      <li key={s.provider + s.name}>
                        {s.nasa ? '🛰 ' : ''}
                        {s.provider}: {s.name} - <span className={s.status === 'ok' ? 'text-emerald-300' : 'text-amber-300'}>{s.status}</span>
                        {s.note ? ` (${s.note})` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}

            {tab === 'contacts' && (
              <section aria-label="Local authorities" className="flex flex-col gap-2.5">
                <div className="rounded-md bg-[#07090E] border border-slate-800 p-3">
                  <h3 className="text-xs font-semibold text-slate-100 mb-1.5">Emergency numbers{report.safety.countryName ? ` - ${report.safety.countryName}` : ''}</h3>
                  <ul className="space-y-1">
                    {report.safety.emergencyNumbers.map((n) => (
                      <li key={n.label + n.number} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-300">{n.label}</span>
                        <a href={`tel:${n.number.replace(/\s/g, '')}`} className="font-mono font-semibold text-rose-200 bg-rose-950/60 border border-rose-700/60 rounded px-2 py-0.5">
                          {n.number}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-400 leading-snug">{report.safety.generalNote}</p>
                </div>
                {report.safety.agencies.length > 0 && (
                  <div className="rounded-md bg-[#07090E] border border-slate-800 p-3">
                    <h3 className="text-xs font-semibold text-slate-100 mb-1.5">Official agencies and warning services</h3>
                    <ul className="space-y-1.5 text-xs">
                      {report.safety.agencies.map((a) => (
                        <li key={a.url}>
                          <ExtLink href={a.url}>{a.name}</ExtLink>
                          <div className="text-[11px] text-slate-500">{a.role}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-slate-500">Directory last reviewed {report.safety.lastReviewed}. Contact details are curated, not AI-generated; always verify with your local authority.</p>
              </section>
            )}

            {tab === 'safety' &&
              report.guidance.map((g) => (
                <section key={g.hazard} aria-label={g.headline} className="rounded-md bg-[#07090E] border border-slate-800 p-3 text-xs text-slate-200">
                  <h3 className="font-semibold text-slate-100 flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                    {g.headline}
                  </h3>
                  {([['Prepare now', g.now], ['If it happens', g.during], ['Afterwards', g.after]] as const).map(([title, items]) => (
                    <div key={title} className="mb-1.5">
                      <h4 className="text-[11px] font-semibold text-cyan-300">{title}</h4>
                      <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
                        {items.map((it) => (
                          <li key={it}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                    {g.sources.map((s) => (
                      <ExtLink key={s.url} href={s.url}>{s.name}</ExtLink>
                    ))}
                  </div>
                </section>
              ))}
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">{report.disclaimer}</p>
        </>
      )}
    </div>
  );
}
