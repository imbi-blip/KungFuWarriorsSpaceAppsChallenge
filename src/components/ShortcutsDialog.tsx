import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space', action: 'Play or pause visualization and sonification' },
  { key: '1 – 4', action: 'Switch between the 4 NASA Earth Science tracks' },
  { key: '← / →', action: 'Scrub timeline backward or forward by 1.5 seconds' },
  { key: 'M', action: 'Mute or unmute Web Audio synthesizer output' },
  { key: 'D', action: 'Describe current frame with AI Audio Narrative' },
  { key: 'R', action: 'Refresh the 20-day hazard outlook and live events' },
  { key: '0', action: 'Reset Earth map zoom to 1× global view' },
  { key: 'Esc', action: 'Stop active voice narration or close dialog' },
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="shortcuts-dialog-title"
      className="m-auto bg-[#0D1320] text-slate-100 border border-slate-700 rounded-lg max-w-md w-[calc(100%-2rem)] p-5 backdrop:bg-black/75"
    >
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <h2 id="shortcuts-dialog-title" className="font-display text-base font-semibold text-slate-50">
          Keyboard Navigation & Accessibility
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close keyboard shortcuts dialog"
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <ul className="mt-4 space-y-2.5">
        {SHORTCUTS.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4 text-xs">
            <span className="text-slate-300">{item.action}</span>
            <kbd className="font-mono px-2 py-1 bg-[#07090E] border border-slate-700 rounded text-cyan-300 whitespace-nowrap shrink-0">
              {item.key}
            </kbd>
          </li>
        ))}
      </ul>

      <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-md hover:bg-cyan-400 transition-colors"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
