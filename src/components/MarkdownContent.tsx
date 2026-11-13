import { Fragment, type ReactNode } from 'react';

interface MarkdownContentProps {
  content: string;
}

function renderInline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code
          key={`code-${keyIndex++}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-900 break-words [overflow-wrap:anywhere]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={`strong-${keyIndex++}`} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(
        <em key={`em-${keyIndex++}`} className="italic text-slate-600">
          {token.slice(1, -1)}
        </em>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`block-${blockKey++}`} className="border-slate-200" />);
      index++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index++;
      }
      index++; // skip closing fence if present

      blocks.push(
        <div
          key={`block-${blockKey++}`}
          className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-slate-100"
        >
          {lang && (
            <div className="border-b border-slate-800 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-400">
              {lang}
            </div>
          )}
          <pre className="max-w-full overflow-x-auto p-3.5 font-mono text-xs leading-relaxed">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const headingClasses =
        level === 1
          ? 'text-lg font-bold text-slate-900 [overflow-wrap:anywhere]'
          : level === 2
            ? 'text-base font-semibold text-slate-900 [overflow-wrap:anywhere]'
            : 'text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]';
      blocks.push(
        <p key={`block-${blockKey++}`} className={headingClasses}>
          {renderInline(headingText)}
        </p>,
      );
      index++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
        index++;
      }
      blocks.push(
        <ul
          key={`block-${blockKey++}`}
          className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]"
        >
          {items.map((item, itemIdx) => (
            <li key={itemIdx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''));
        index++;
      }
      blocks.push(
        <ol
          key={`block-${blockKey++}`}
          className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]"
        >
          {items.map((item, itemIdx) => (
            <li key={itemIdx}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph (collect contiguous non-empty lines that don't start a new block)
    const paraLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (
        !currentTrimmed ||
        currentTrimmed.startsWith('```') ||
        /^(#{1,4})\s+/.test(currentTrimmed) ||
        /^[-*]\s+/.test(currentTrimmed) ||
        /^\d+\.\s+/.test(currentTrimmed)
      ) {
        break;
      }
      paraLines.push(currentTrimmed);
      index++;
    }

    blocks.push(
      <p
        key={`block-${blockKey++}`}
        className="text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]"
      >
        {paraLines.map((paraLine, lineIdx) => (
          <Fragment key={lineIdx}>
            {lineIdx > 0 && ' '}
            {renderInline(paraLine)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="min-w-0 space-y-3 break-words">{blocks}</div>;
}
