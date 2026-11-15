import { useCallback, useEffect, useRef, useState } from 'react';
import type { RiskReport } from '../../shared/types';
import { fetchBrief, fetchRisk } from '../api/riskApi';

export type RiskStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LocationRiskState {
  status: RiskStatus;
  point: { lat: number; lon: number } | null;
  report: RiskReport | null;
  aiBrief: string | null;
  aiStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  error: string | null;
}

const INITIAL: LocationRiskState = { status: 'idle', point: null, report: null, aiBrief: null, aiStatus: 'idle', error: null };

/** Loads the 20-day wildfire/flood/tsunami report for a clicked point, cancelling any in-flight request. */
export function useLocationRisk() {
  const [state, setState] = useState<LocationRiskState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = useCallback(async (lat: number, lon: number) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setState({ status: 'loading', point: { lat, lon }, report: null, aiBrief: null, aiStatus: 'idle', error: null });
    try {
      const report = await fetchRisk(lat, lon, ctl.signal);
      if (ctl.signal.aborted) return;
      setState({ status: 'ready', point: { lat, lon }, report, aiBrief: null, aiStatus: report.aiAvailable ? 'loading' : 'idle', error: null });
      if (report.aiAvailable) {
        try {
          const b = await fetchBrief(lat, lon, ctl.signal);
          if (!ctl.signal.aborted) setState((s) => ({ ...s, aiBrief: b.text, aiStatus: 'ready' }));
        } catch {
          if (!ctl.signal.aborted) setState((s) => ({ ...s, aiStatus: 'unavailable' })); // rule-based briefing remains
        }
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
      setState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : 'Unable to load risk data.' }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { state, load, reset };
}
