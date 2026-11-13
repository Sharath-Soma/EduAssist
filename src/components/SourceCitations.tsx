import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AssistantSource } from '../../shared/types/knowledge.ts';

interface SourceCitationsProps {
  messageId: string;
  sources: AssistantSource[];
}

export function buildCitationKey(
  messageId: string,
  source: AssistantSource,
  index: number,
): string {
  const docPart = source.documentId?.trim() || 'doc';
  const pagePart =
    typeof source.page === 'number' && Number.isFinite(source.page)
      ? String(source.page)
      : 'na';
  return `${messageId}::${docPart}::${pagePart}::${index}`;
}

export function toggleCitationSelection(
  current: ReadonlySet<string>,
  citationKey: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(citationKey)) {
    next.delete(citationKey);
  } else {
    next.add(citationKey);
  }
  return next;
}

export function SourceCitations({ messageId, sources }: SourceCitationsProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  if (!sources || sources.length === 0) {
    return null;
  }

  const handleToggle = (citationKey: string) => {
    setExpandedKeys((prev) => toggleCitationSelection(prev, citationKey));
  };

  return (
    <section
      aria-label="Source Citations"
      className="border-t border-slate-200 pt-4 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-slate-700">
          Source Citations ({sources.length})
        </h2>
      </div>

      <ul className="space-y-2">
        {sources.map((source, index) => {
          const citationKey = buildCitationKey(messageId, source, index);
          const isExpanded = expandedKeys.has(citationKey);
          const panelId = `citation-excerpt-${citationKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

          const documentTitle =
            source.title?.trim() || 'Untitled institutional document';
          const hasValidPage =
            typeof source.page === 'number' &&
            Number.isFinite(source.page) &&
            source.page > 0;
          const hasValidScore =
            typeof source.similarityScore === 'number' &&
            Number.isFinite(source.similarityScore);
          const excerptText = source.excerpt?.trim() || '';

          return (
            <li
              key={citationKey}
              className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden"
            >
              <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-semibold text-slate-900 [overflow-wrap:anywhere]">
                    {documentTitle}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                    <span>{hasValidPage ? `Page ${source.page}` : 'Page N/A'}</span>
                    {hasValidScore && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Relevance {source.similarityScore!.toFixed(2)}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle(citationKey)}
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  className="inline-flex min-h-[40px] sm:min-h-[32px] w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <span>{isExpanded ? 'Hide Source' : 'View Source'}</span>
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                </button>
              </div>

              {isExpanded && (
                <div
                  id={panelId}
                  className="border-t border-slate-200 bg-white px-3 py-2.5"
                >
                  {excerptText ? (
                    <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {excerptText}
                    </p>
                  ) : (
                    <p className="text-xs italic text-slate-500">
                      No excerpt text available for this citation.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
