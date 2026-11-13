import { CheckCircle2, Clock3, AlertTriangle, RefreshCw } from 'lucide-react';
import type { SystemHealthResponse } from '../../shared/types/knowledge.ts';

interface ArchitectureOverviewProps {
  health: SystemHealthResponse | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function StatusLabel({
  status,
}: {
  status: 'ready' | 'scaffolded' | 'not_configured';
}) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Ready
      </span>
    );
  }

  if (status === 'not_configured') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Awaiting Secret
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
      Scaffolded
    </span>
  );
}

export function ArchitectureOverview({
  health,
  isLoading,
  error,
  onRefresh,
}: ArchitectureOverviewProps) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            System Architecture &amp; Module Readiness
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live backend inspection of server modules, storage contracts, and RAG pipeline
            status.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 sm:w-auto"
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh Status
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          {error}
        </div>
      )}

      {health && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Server LLM Status</p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {health.llmConfigured
                  ? 'Configured on Server'
                  : 'GEMINI_API_KEY Not Set'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Storage Adapter</p>
              <p className="mt-1 font-mono text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">
                {health.storageProvider}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">RAG Pipeline Stage</p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {health.ragPipelineActive ? 'Active' : 'Scaffold Initialized'}
              </p>
            </div>
          </div>

          <div className="space-y-3 sm:hidden">
            {health.modules.map((mod) => (
              <article
                key={mod.name}
                className="rounded-xl border border-slate-200 bg-white p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
                      {mod.name}
                    </h2>
                    <p className="font-mono text-xs text-slate-500">{mod.layer}</p>
                  </div>
                  <div className="shrink-0">
                    <StatusLabel status={mod.status} />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
                  {mod.description}
                </p>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Layer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Responsibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {health.modules.map((mod) => (
                  <tr key={mod.name} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">{mod.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {mod.layer}
                    </td>
                    <td className="px-4 py-3">
                      <StatusLabel status={mod.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{mod.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
