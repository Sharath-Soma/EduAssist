import { useEffect } from 'react';
import { BookOpen, Building2, FolderPlus, GraduationCap, X } from 'lucide-react';
import type {
  AcademicTrack,
  InstitutionCollection,
  KnowledgeSourceMode,
} from '../../shared/types/knowledge.ts';

interface SidebarProps {
  academicTrack: AcademicTrack;
  onChangeTrack: (track: AcademicTrack) => void;
  knowledgeMode: KnowledgeSourceMode;
  onChangeKnowledgeMode: (mode: KnowledgeSourceMode) => void;
  collections: InstitutionCollection[];
  selectedCollectionId: string | null;
  onSelectCollection: (id: string | null) => void;
  onCreateCollectionClick: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const ACADEMIC_TRACKS: Array<{
  id: AcademicTrack;
  label: string;
  group: 'School (Classes 6–12)' | 'College (Higher Ed)';
}> = [
  { id: 'classes_6_8', label: 'Classes 6–8', group: 'School (Classes 6–12)' },
  { id: 'classes_9_10', label: 'Classes 9–10', group: 'School (Classes 6–12)' },
  { id: 'classes_11_12', label: 'Classes 11–12', group: 'School (Classes 6–12)' },
  { id: 'degree', label: 'Degree Programs', group: 'College (Higher Ed)' },
  {
    id: 'btech_engineering',
    label: 'B.Tech & Engineering',
    group: 'College (Higher Ed)',
  },
];

const KNOWLEDGE_MODES: Array<{
  id: KnowledgeSourceMode;
  label: string;
  summary: string;
}> = [
  {
    id: 'dual',
    label: 'Separated Dual Mode',
    summary: 'Separates PDF-grounded institutional answers from general tutoring.',
  },
  {
    id: 'institutional',
    label: 'Institutional PDFs Only',
    summary: 'Answers strictly from uploaded institutional regulations and handbooks.',
  },
  {
    id: 'educational',
    label: 'General Subjects Only',
    summary: 'Explains STEM, programming, math, and curriculum concepts.',
  },
];

export function Sidebar({
  academicTrack,
  onChangeTrack,
  knowledgeMode,
  onChangeKnowledgeMode,
  collections,
  selectedCollectionId,
  onSelectCollection,
  onCreateCollectionClick,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  useEffect(() => {
    if (!isMobileOpen || !onCloseMobile) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseMobile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  const closeOnMobileSelect = () => {
    if (isMobileOpen && onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {isMobileOpen && onCloseMobile && (
        <div
          aria-hidden="true"
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        id="workspace-sidebar-drawer"
        aria-label="Workspace configuration"
        className={`fixed inset-y-0 left-0 z-40 w-[min(20rem,88vw)] overflow-y-auto border-r border-slate-200 bg-white p-5 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-72 lg:shrink-0 lg:translate-x-0 lg:overflow-visible ${
          isMobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full lg:shadow-none'
        }`}
      >
        <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-3 lg:hidden">
          <span className="text-sm font-semibold text-slate-900">
            Workspace Settings
          </span>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close settings panel"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="text-xs font-semibold text-slate-500">Student Track</h2>
            <div className="mt-2.5 space-y-1">
              {ACADEMIC_TRACKS.map((track) => {
                const active = academicTrack === track.id;
                const isCollege = track.group.startsWith('College');
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      onChangeTrack(track.id);
                      closeOnMobileSelect();
                    }}
                    className={`flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-blue-50 font-medium text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isCollege ? (
                        <GraduationCap className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{track.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="border-t border-slate-200" />

          <section>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-slate-500">
                Institution Collection
              </h2>
              <button
                type="button"
                onClick={() => {
                  onCreateCollectionClick();
                  closeOnMobileSelect();
                }}
                className="inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                Add
              </button>
            </div>

            {collections.length === 0 ? (
              <div className="mt-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3.5">
                <p className="text-xs leading-relaxed text-slate-600">
                  No school or college PDF collections created yet. Create a collection to
                  scope institutional queries.
                </p>
              </div>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onSelectCollection(null);
                    closeOnMobileSelect();
                  }}
                  className={`min-h-[44px] w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                    selectedCollectionId === null
                      ? 'bg-slate-100 font-medium text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  No collection selected
                </button>
                {collections.map((collection) => {
                  const selected = selectedCollectionId === collection.id;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => {
                        onSelectCollection(collection.id);
                        closeOnMobileSelect();
                      }}
                      className={`flex min-h-[44px] w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-blue-700 bg-blue-50/70 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <Building2
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{collection.name}</p>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {collection.institutionType === 'school' ? 'School' : 'College'} ·{' '}
                          {collection.documentCount === 1
                            ? '1 PDF'
                            : `${collection.documentCount} PDFs`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="border-t border-slate-200" />

          <section>
            <h2 className="text-xs font-semibold text-slate-500">Knowledge Boundary</h2>
            <div className="mt-2.5 space-y-1.5">
              {KNOWLEDGE_MODES.map((mode) => {
                const active = knowledgeMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      onChangeKnowledgeMode(mode.id);
                      closeOnMobileSelect();
                    }}
                    className={`min-h-[44px] w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-blue-700 bg-blue-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900">{mode.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                      {mode.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
