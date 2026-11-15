import { Keyboard } from 'lucide-react';

interface HeaderProps {
  onOpenShortcuts: () => void;
}

export function Header({ onOpenShortcuts }: HeaderProps) {
  return (
    <header className="h-12 border-b border-slate-800 bg-[#0A0E17] px-4 lg:px-6 flex items-center justify-between gap-8">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#top"
        className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 hover:text-cyan-300 transition-colors"
      >
        The Earth Jukebox
      </a>

      {/* Zone 2: Clean single-line anchor navigation links */}
      <nav aria-label="Primary observatory sections" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
        <a
          href="#datasets-panel"
          className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1"
        >
          Earth Tracks
        </a>
        <a
          href="#canvas-stage"
          className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1"
        >
          Live Canvas
        </a>
        <a
          href="#sonification-panel"
          className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1"
        >
          Sonification
        </a>
        <a
          href="#ai-intelligence-panel"
          className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1"
        >
          Disaster AI & Narrator
        </a>
      </nav>

      {/* Zone 3: Single primary header action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-100 bg-slate-900 border border-slate-700 rounded-md hover:border-cyan-400/70 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
        >
          <Keyboard className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          <span>Shortcuts</span>
        </button>
      </div>
    </header>
  );
}
