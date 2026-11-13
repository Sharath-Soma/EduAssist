import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookMarked,
  FileText,
  GraduationCap,
  HelpCircle,
  Loader2,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type {
  AcademicTrack,
  AssistantQueryResponse,
  ConversationMessage,
  InstitutionCollection,
  KnowledgeSourceMode,
  KnowledgeType,
  RetrievalMetadata,
} from '../../shared/types/knowledge.ts';
import { streamAssistantQuery } from '../services/apiClient.ts';
import { MarkdownContent } from './MarkdownContent.tsx';
import { SourceCitations } from './SourceCitations.tsx';

interface AssistantWorkspaceProps {
  academicTrack: AcademicTrack;
  knowledgeMode: KnowledgeSourceMode;
  selectedCollection: InstitutionCollection | null;
  onOpenCollections: () => void;
  onOpenSidebar?: () => void;
}

interface WorkspaceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: AssistantQueryResponse;
  isStreaming?: boolean;
  statusMessage?: string;
  streamingMeta?: {
    knowledgeType: KnowledgeType;
    retrievalMetadata: RetrievalMetadata;
  };
  mainText?: string;
  institutionalText?: string;
  educationalText?: string;
  error?: string;
  failedQuery?: string;
}

const TRACK_LABELS: Record<AcademicTrack, string> = {
  classes_6_8: 'School · Classes 6–8',
  classes_9_10: 'School · Classes 9–10',
  classes_11_12: 'School · Classes 11–12',
  degree: 'College · Degree Programs',
  btech_engineering: 'College · B.Tech & Engineering',
};

const MODE_LABELS: Record<KnowledgeSourceMode, string> = {
  dual: 'Separated Dual Mode',
  institutional: 'Institutional PDFs Only',
  educational: 'General Subjects Only',
};

function getKnowledgeTypeMeta(knowledgeType: KnowledgeType): {
  label: string;
  accentClass: string;
  icon: 'institutional' | 'educational' | 'clarification' | 'warning';
} {
  switch (knowledgeType) {
    case 'institutional':
      return {
        label: 'Institutional Knowledge',
        accentClass: 'text-blue-800',
        icon: 'institutional',
      };
    case 'educational':
      return {
        label: 'General Educational Knowledge',
        accentClass: 'text-slate-800',
        icon: 'educational',
      };
    case 'dual':
      return {
        label: 'Institutional Knowledge & General Educational Knowledge',
        accentClass: 'text-blue-800',
        icon: 'institutional',
      };
    case 'clarification':
      return {
        label: 'Clarification Needed',
        accentClass: 'text-slate-700',
        icon: 'clarification',
      };
    case 'insufficient_evidence':
      return {
        label: 'Insufficient Institutional Evidence',
        accentClass: 'text-amber-800',
        icon: 'warning',
      };
  }
}

function KnowledgeTypeIcon({
  icon,
  className,
}: {
  icon: 'institutional' | 'educational' | 'clarification' | 'warning';
  className?: string;
}) {
  switch (icon) {
    case 'institutional':
      return <FileText className={className} aria-hidden="true" />;
    case 'educational':
      return <GraduationCap className={className} aria-hidden="true" />;
    case 'clarification':
      return <HelpCircle className={className} aria-hidden="true" />;
    case 'warning':
      return <AlertCircle className={className} aria-hidden="true" />;
  }
}

export function AssistantWorkspace({
  academicTrack,
  knowledgeMode,
  selectedCollection,
  onOpenCollections,
  onOpenSidebar,
}: AssistantWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const missingRequiredCollection =
    knowledgeMode === 'institutional' && !selectedCollection;

  function buildHistoryFromMessages(items: WorkspaceMessage[]): ConversationMessage[] {
    const history: ConversationMessage[] = [];
    for (const item of items) {
      if (item.error || item.isStreaming) {
        continue;
      }
      if (!item.content.trim()) {
        continue;
      }
      history.push({
        role: item.role,
        content: item.content,
      });
    }
    return history.slice(-6);
  }

  async function executeQuery(
    trimmedQuery: string,
    options?: { retryMessageId?: string },
  ) {
    if (!trimmedQuery || isSubmitting || missingRequiredCollection) {
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const historySnapshot = buildHistoryFromMessages(
      options?.retryMessageId
        ? messages.filter((msg) => msg.id !== options.retryMessageId)
        : messages,
    );

    const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const placeholderMessage: WorkspaceMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      statusMessage:
        knowledgeMode === 'educational'
          ? 'Preparing educational explanation...'
          : 'Searching institutional documents...',
      mainText: '',
      institutionalText: '',
      educationalText: '',
    };

    if (!options?.retryMessageId) {
      const userMessage: WorkspaceMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        content: trimmedQuery,
      };
      setMessages((prev) => [...prev, userMessage, placeholderMessage]);
      setQuery('');
    } else {
      setMessages((prev) =>
        prev
          .filter((msg) => msg.id !== options.retryMessageId)
          .concat(placeholderMessage),
      );
    }

    setIsSubmitting(true);

    try {
      const finalResponse = await streamAssistantQuery(
        {
          query: trimmedQuery,
          collectionId: selectedCollection?.id ?? null,
          academicTrack,
          mode: knowledgeMode,
          history: historySnapshot,
        },
        (event) => {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMessageId) {
                return msg;
              }

              if (event.type === 'status') {
                return {
                  ...msg,
                  statusMessage: event.message,
                };
              }

              if (event.type === 'meta') {
                return {
                  ...msg,
                  streamingMeta: {
                    knowledgeType: event.knowledgeType,
                    retrievalMetadata: event.retrievalMetadata,
                  },
                };
              }

              if (event.type === 'chunk') {
                if (event.section === 'institutional') {
                  return {
                    ...msg,
                    institutionalText: (msg.institutionalText ?? '') + event.text,
                  };
                }
                if (event.section === 'educational') {
                  return {
                    ...msg,
                    educationalText: (msg.educationalText ?? '') + event.text,
                  };
                }
                return {
                  ...msg,
                  mainText: (msg.mainText ?? '') + event.text,
                };
              }

              if (event.type === 'done') {
                return {
                  ...msg,
                  isStreaming: false,
                  statusMessage: undefined,
                  content: event.response.answer,
                  response: event.response,
                };
              }

              return msg;
            }),
          );
        },
        controller.signal,
      );

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                isStreaming: false,
                statusMessage: undefined,
                content: finalResponse.answer,
                response: finalResponse,
              }
            : msg,
        ),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      const messageText =
        error instanceof Error ? error.message : 'Unable to reach assistant endpoint.';

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: 'assistant',
                content: '',
                error: messageText,
                failedQuery: trimmedQuery,
              }
            : msg,
        ),
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    await executeQuery(trimmed);
  }

  function handleClearConversation() {
    if (isSubmitting) {
      return;
    }
    abortControllerRef.current?.abort();
    setMessages([]);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8">
      <div className="space-y-3 border-b border-slate-200 pb-5 sm:pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{TRACK_LABELS[academicTrack]}</span>
            <span aria-hidden="true">·</span>
            <span>{MODE_LABELS[knowledgeMode]}</span>
            <span aria-hidden="true">·</span>
            <span className="[overflow-wrap:anywhere]">
              {selectedCollection
                ? `Collection: ${selectedCollection.name}`
                : 'No institutional collection selected'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenSidebar && (
              <button
                type="button"
                onClick={onOpenSidebar}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 lg:hidden"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Settings
              </button>
            )}

            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleClearConversation}
                disabled={isSubmitting}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Clear conversation
              </button>
            )}
          </div>
        </div>

        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-3xl text-balance">
          Educational &amp; Institutional Assistant
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
          EduAssist separates verified institutional rules extracted from uploaded school
          or college PDFs from general academic explanations in mathematics, science, and
          engineering.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4"
      >
        <label
          htmlFor="assistant-query-input"
          className="block text-xs font-semibold text-slate-700"
        >
          Ask an academic or institutional question
        </label>
        <div className="mt-2 flex flex-col gap-2.5 sm:flex-row sm:gap-3">
          <input
            id="assistant-query-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={isSubmitting}
            placeholder={
              knowledgeMode === 'educational'
                ? 'Ask a subject question in math, science, or engineering...'
                : 'Ask about an institutional rule or a curriculum concept...'
            }
            className="min-h-[44px] w-full min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={
              isSubmitting || query.trim().length === 0 || missingRequiredCollection
            }
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap shrink-0 sm:w-auto"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting ? 'Answering...' : 'Submit Query'}
          </button>
        </div>

        {missingRequiredCollection && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            <span>
              Select an institution collection in Settings before querying in
              Institutional PDFs Only mode.
            </span>
            <button
              type="button"
              onClick={onOpenCollections}
              className="min-h-[36px] font-semibold text-amber-900 underline hover:text-amber-950"
            >
              Open collections
            </button>
          </div>
        )}
      </form>

      {messages.length > 0 && (
        <section aria-label="Conversation history" className="space-y-4">
          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <div
                  key={message.id}
                  className="rounded-xl border border-slate-200 bg-slate-100/70 px-4 py-3"
                >
                  <p className="text-xs font-semibold text-slate-500">Student Question</p>
                  <p className="mt-1 text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">
                    {message.content}
                  </p>
                </div>
              );
            }

            if (message.error) {
              return (
                <div
                  key={message.id}
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-red-950">Query failed</p>
                        <p className="mt-0.5 text-red-800 [overflow-wrap:anywhere]">
                          {message.error}
                        </p>
                      </div>
                    </div>
                    {message.failedQuery && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() =>
                          void executeQuery(message.failedQuery!, {
                            retryMessageId: message.id,
                          })
                        }
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-800 transition-colors hover:bg-red-100 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            const resp = message.response;

            // Streaming / pre-completion view
            if (!resp) {
              const hasInstStream = Boolean(message.institutionalText?.trim());
              const hasEduStream = Boolean(message.educationalText?.trim());
              const hasMainStream = Boolean(message.mainText?.trim());
              const hasAnyStreamText = hasInstStream || hasEduStream || hasMainStream;
              const activeMeta = message.streamingMeta
                ? getKnowledgeTypeMeta(message.streamingMeta.knowledgeType)
                : null;
              const retrievalMeta = message.streamingMeta?.retrievalMetadata;

              return (
                <article
                  key={message.id}
                  aria-live="polite"
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2">
                      {activeMeta ? (
                        <>
                          <KnowledgeTypeIcon
                            icon={activeMeta.icon}
                            className={`h-4 w-4 shrink-0 ${activeMeta.accentClass}`}
                          />
                          <span className={`text-xs font-semibold ${activeMeta.accentClass}`}>
                            {activeMeta.label}
                          </span>
                        </>
                      ) : (
                        <>
                          <Loader2
                            className="h-4 w-4 animate-spin text-blue-700 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="text-xs font-semibold text-slate-700">
                            {message.statusMessage ?? 'Preparing response...'}
                          </span>
                        </>
                      )}
                    </div>

                    {retrievalMeta && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                        {retrievalMeta.collectionName && (
                          <span className="[overflow-wrap:anywhere]">
                            {retrievalMeta.collectionName}
                          </span>
                        )}
                        {retrievalMeta.collectionName &&
                          retrievalMeta.retrievedChunks > 0 && (
                            <span aria-hidden="true">·</span>
                          )}
                        {retrievalMeta.retrievedChunks > 0 && (
                          <span>
                            {retrievalMeta.retrievedChunks} retrieved{' '}
                            {retrievalMeta.retrievedChunks === 1 ? 'chunk' : 'chunks'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {!hasAnyStreamText ? (
                    <div className="flex items-center gap-2.5 py-1 text-sm text-slate-600">
                      <Loader2
                        className="h-4 w-4 animate-spin text-blue-700 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{message.statusMessage ?? 'Generating answer...'}</span>
                    </div>
                  ) : hasInstStream || hasEduStream ? (
                    <div className="space-y-5">
                      {hasInstStream && (
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2 text-xs font-semibold text-blue-800">
                            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>Institutional Knowledge</span>
                          </div>
                          <MarkdownContent content={message.institutionalText!} />
                        </div>
                      )}
                      {hasEduStream && (
                        <div className="border-t border-slate-200 pt-4 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                              <GraduationCap
                                className="h-3.5 w-3.5 shrink-0 text-blue-700"
                                aria-hidden="true"
                              />
                              <span>General Educational Knowledge</span>
                            </div>
                            <span className="text-xs text-slate-500">
                              Not an official institutional policy
                            </span>
                          </div>
                          <MarkdownContent content={message.educationalText!} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <MarkdownContent content={message.mainText ?? ''} />
                  )}

                  {hasAnyStreamText && message.isStreaming && (
                    <div className="flex items-center gap-2 pt-1 text-xs text-slate-500">
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-blue-700 shrink-0"
                        aria-hidden="true"
                      />
                      <span>Streaming response...</span>
                    </div>
                  )}
                </article>
              );
            }

            const meta = getKnowledgeTypeMeta(resp.knowledgeType);
            const showDualSplit =
              resp.knowledgeType === 'dual' &&
              resp.institutionalSection &&
              resp.educationalSection;

            return (
              <article
                key={message.id}
                className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <KnowledgeTypeIcon
                      icon={meta.icon}
                      className={`h-4 w-4 shrink-0 ${meta.accentClass}`}
                    />
                    <span className={`text-xs font-semibold ${meta.accentClass}`}>
                      {meta.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                    {resp.retrievalMetadata.collectionName && (
                      <span className="[overflow-wrap:anywhere]">
                        {resp.retrievalMetadata.collectionName}
                      </span>
                    )}
                    {resp.retrievalMetadata.collectionName &&
                      resp.retrievalMetadata.retrievedChunks > 0 && (
                        <span aria-hidden="true">·</span>
                      )}
                    {resp.retrievalMetadata.retrievedChunks > 0 && (
                      <span>
                        {resp.retrievalMetadata.retrievedChunks} retrieved{' '}
                        {resp.retrievalMetadata.retrievedChunks === 1
                          ? 'chunk'
                          : 'chunks'}
                      </span>
                    )}
                  </div>
                </div>

                {showDualSplit ? (
                  <div className="space-y-5">
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-blue-800">
                        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>Institutional Knowledge</span>
                      </div>
                      <MarkdownContent content={resp.institutionalSection!} />
                    </div>

                    <div className="border-t border-slate-200 pt-4 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                          <GraduationCap
                            className="h-3.5 w-3.5 shrink-0 text-blue-700"
                            aria-hidden="true"
                          />
                          <span>General Educational Knowledge</span>
                        </div>
                        <span className="text-xs text-slate-500">
                          Not an official institutional policy
                        </span>
                      </div>
                      <MarkdownContent content={resp.educationalSection!} />
                    </div>
                  </div>
                ) : (
                  <MarkdownContent content={resp.answer} />
                )}

                <SourceCitations messageId={message.id} sources={resp.sources} />
              </article>
            );
          })}
        </section>
      )}

      {messages.length === 0 && (
        <section className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2.5 text-slate-900">
              <FileText className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
              <h2 className="text-base font-semibold">Institutional Knowledge</h2>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
              Strictly grounded in uploaded school and college PDFs covering attendance
              rules, examinations, academic regulations, admissions, fees, and
              scholarships.
            </p>
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <p>Required citations: Document name · Page number · Retrieved excerpt</p>
              <button
                type="button"
                onClick={onOpenCollections}
                className="mt-2 inline-flex min-h-[44px] items-center font-medium text-blue-700 hover:text-blue-800"
              >
                Manage institution collections
              </button>
            </div>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2.5 text-slate-900">
              <GraduationCap className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
              <h2 className="text-base font-semibold">General Educational Knowledge</h2>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
              Concept explanations, worked steps, programming, mathematics, and science
              tutoring tailored to Classes 6–12, Degree, and B.Tech curricula.
            </p>
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <BookMarked className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Never presented as an official institutional policy</span>
            </div>
          </article>
        </section>
      )}
    </div>
  );
}
