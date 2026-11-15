import { Loader2, Sparkles, Square, Volume2 } from 'lucide-react';

interface AiNarratorPanelProps {
  narrative: string | null;
  isAnalyzing: boolean;
  isSpeaking: boolean;
  speechRate: number;
  error: string | null;
  speechSupported: boolean;
  onDescribeFrame: () => void;
  onSpeakNarrative: () => void;
  onStopSpeech: () => void;
  onChangeSpeechRate: (rate: number) => void;
}

export function AiNarratorPanel({
  narrative,
  isAnalyzing,
  isSpeaking,
  speechRate,
  error,
  speechSupported,
  onDescribeFrame,
  onSpeakNarrative,
  onStopSpeech,
  onChangeSpeechRate,
}: AiNarratorPanelProps) {
  return (
    <div id="ai-narrator-panel" className="flex flex-col justify-between gap-3 flex-1 min-h-0">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDescribeFrame}
            disabled={isAnalyzing}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-h-[38px]"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Analyzing Active Frame...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                <span>Describe Current Frame (AI Audio Narrative)</span>
              </>
            )}
          </button>

          {speechSupported && narrative && (
            <button
              type="button"
              onClick={isSpeaking ? onStopSpeech : onSpeakNarrative}
              aria-label={isSpeaking ? 'Stop speech playback' : 'Read narrative aloud'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap min-h-[38px] ${
                isSpeaking
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                  : 'bg-slate-900 border-slate-700 text-slate-100 hover:border-cyan-400/70'
              }`}
            >
              {isSpeaking ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  <span>Stop Voice</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                  <span>Replay Voice</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* ARIA Live Region for Narrative Output */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="rounded-md bg-[#07090E] border border-slate-800 p-3 min-h-[135px] flex flex-col justify-center"
        >
          {error ? (
            <p className="text-xs text-rose-300 leading-relaxed" role="alert">
              {error}
            </p>
          ) : isAnalyzing ? (
            <p className="text-xs text-cyan-300 leading-relaxed">
              Capturing active Earth observation frame and generating spoken scientific narrative...
            </p>
          ) : narrative ? (
            <p className="text-sm text-slate-100 leading-relaxed">{narrative}</p>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed">
              Select &ldquo;Describe Current Frame (AI Audio Narrative)&rdquo; or press{' '}
              <kbd className="font-mono px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded">D</kbd>{' '}
              to analyze the active global map or uploaded NASA EIC media and play an accessible
              voice description.
            </p>
          )}
        </div>
      </div>

      {/* Speech Rate Controls */}
      <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-slate-800/80 text-xs">
        <span className="text-slate-400">
          {speechSupported ? 'Browser Speech Synthesis Ready' : 'Speech synthesis unavailable in browser'}
        </span>
        {speechSupported && (
          <div className="flex items-center gap-1" role="group" aria-label="Speech playback speed">
            <span className="text-slate-400 mr-1">Voice Rate</span>
            {[1, 1.25, 1.5].map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={speechRate === r}
                onClick={() => onChangeSpeechRate(r)}
                className={`px-2 py-1 font-mono text-xs rounded transition-colors ${
                  speechRate === r
                    ? 'bg-slate-800 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {r}x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
