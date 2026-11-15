import { Fragment } from 'react';

interface MarkdownTextProps {
  markdown: string;
}

function renderInlineBold(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

export function MarkdownText({ markdown }: MarkdownTextProps) {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-1.5 text-xs text-slate-200 leading-relaxed">
      {lines.map((line, idx) => {
        if (line.startsWith('### ') || line.startsWith('## ') || line.startsWith('# ')) {
          const text = line.replace(/^#{1,3}\s+/, '');
          return (
            <h4 key={idx} className="font-display text-xs font-semibold text-cyan-300 pt-1">
              {renderInlineBold(text)}
            </h4>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-0.5">
              <span aria-hidden="true" className="text-cyan-400 mt-0.5 shrink-0">
                •
              </span>
              <span>{renderInlineBold(line.slice(2))}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInlineBold(line)}</p>;
      })}
    </div>
  );
}
