import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface JsonViewerProps {
  value: unknown;
  title?: string;
  maxHeightClass?: string;
}

function renderHighlightedLines(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const tokens: React.ReactNode[] = [];
    const regex =
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let tokenIdx = 0;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(
          <span key={`p-${tokenIdx++}`} className="text-[#8b92a5]">
            {line.slice(lastIndex, match.index)}
          </span>
        );
      }
      const token = match[0];
      let cls = 'text-[#d4d8e4]';
      if (token.startsWith('"')) {
        if (token.endsWith(':')) {
          cls = 'text-sky-300';
        } else {
          cls = 'text-emerald-300';
        }
      } else if (token === 'true' || token === 'false') {
        cls = 'text-amber-300';
      } else if (token === 'null') {
        cls = 'text-rose-300';
      } else {
        cls = 'text-violet-300';
      }

      tokens.push(
        <span key={`t-${tokenIdx++}`} className={cls}>
          {token}
        </span>
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      tokens.push(
        <span key={`e-${tokenIdx++}`} className="text-[#8b92a5]">
          {line.slice(lastIndex)}
        </span>
      );
    }

    return (
      <div key={lineIdx} className="leading-5">
        {tokens.length > 0 ? tokens : ' '}
      </div>
    );
  });
}

export function JsonViewer({
  value,
  title,
  maxHeightClass = 'max-h-96',
}: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const { formatted, isJson } = useMemo(() => {
    if (value === null || value === undefined || value === '') {
      return { formatted: '', isJson: false };
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
      } catch {
        return { formatted: value, isJson: false };
      }
    }
    try {
      return { formatted: JSON.stringify(value, null, 2), isJson: true };
    } catch {
      return { formatted: String(value), isJson: false };
    }
  }, [value]);

  const handleCopy = async () => {
    if (!formatted) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored in sandboxed iframes without clipboard permission
    }
  };

  return (
    <div className="border border-[#1d2028] bg-[#0c0d11] rounded-md overflow-hidden">
      {(title || formatted) && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1d2028] bg-[#101218]">
          <span className="text-xs font-medium text-[#9aa1b4]">{title || 'Payload'}</span>
          {formatted && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-[#9aa1b4] hover:text-[#e8eaef] hover:bg-[#1a1d26] rounded transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
      <pre
        className={`p-3 font-mono text-xs overflow-auto whitespace-pre-wrap break-all ${maxHeightClass}`}
      >
        {!formatted ? (
          <span className="text-[#646b7d]">Empty body</span>
        ) : isJson ? (
          renderHighlightedLines(formatted)
        ) : (
          <span className="text-[#d4d8e4]">{formatted}</span>
        )}
      </pre>
    </div>
  );
}
