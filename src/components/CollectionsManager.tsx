import { type FormEvent, useState } from 'react';
import { Building2, FileText, FolderOpen, Plus } from 'lucide-react';
import type {
  AcademicTrack,
  InstitutionCollection,
  InstitutionType,
} from '../../shared/types/knowledge.ts';

interface CollectionsManagerProps {
  collections: InstitutionCollection[];
  isLoading: boolean;
  selectedCollectionId: string | null;
  onSelectCollection: (id: string) => void;
  onManageDocuments: (id: string) => void;
  onCreateCollection: (input: {
    name: string;
    institutionType: InstitutionType;
    academicTrack: AcademicTrack;
    description: string;
  }) => Promise<void>;
  showCreateForm: boolean;
  onToggleCreateForm: (open: boolean) => void;
}

const TRACK_OPTIONS: Array<{ value: AcademicTrack; label: string }> = [
  { value: 'classes_6_8', label: 'School: Classes 6–8' },
  { value: 'classes_9_10', label: 'School: Classes 9–10' },
  { value: 'classes_11_12', label: 'School: Classes 11–12' },
  { value: 'degree', label: 'College: Degree' },
  { value: 'btech_engineering', label: 'College: B.Tech & Engineering' },
];

export function CollectionsManager({
  collections,
  isLoading,
  selectedCollectionId,
  onSelectCollection,
  onManageDocuments,
  onCreateCollection,
  showCreateForm,
  onToggleCreateForm,
}: CollectionsManagerProps) {
  const [name, setName] = useState('');
  const [institutionType, setInstitutionType] = useState<InstitutionType>('school');
  const [academicTrack, setAcademicTrack] = useState<AcademicTrack>('classes_11_12');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setFormError('Enter an institution or collection name (minimum 2 characters).');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onCreateCollection({
        name: name.trim(),
        institutionType,
        academicTrack,
        description: description.trim(),
      });
      setName('');
      setDescription('');
      onToggleCreateForm(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Failed to create collection.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Institutional Collections
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Isolated PDF collections designed for multiple schools and colleges.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onToggleCreateForm(!showCreateForm)}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 sm:w-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {showCreateForm ? 'Close Form' : 'Create Collection'}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">
            New School or College Collection
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="collection-name"
                className="block text-xs font-semibold text-slate-700"
              >
                Institution / Collection Name
              </label>
              <input
                id="collection-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g., Central High School Regulations"
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="institution-type"
                className="block text-xs font-semibold text-slate-700"
              >
                Institution Type
              </label>
              <select
                id="institution-type"
                value={institutionType}
                onChange={(event) => {
                  const nextType = event.target.value as InstitutionType;
                  setInstitutionType(nextType);
                  setAcademicTrack(
                    nextType === 'school' ? 'classes_11_12' : 'btech_engineering',
                  );
                }}
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="school">School (Classes 6–12)</option>
                <option value="college">College (Degree / B.Tech / Engineering)</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="academic-track"
                className="block text-xs font-semibold text-slate-700"
              >
                Primary Academic Track
              </label>
              <select
                id="academic-track"
                value={academicTrack}
                onChange={(event) =>
                  setAcademicTrack(event.target.value as AcademicTrack)
                }
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                {TRACK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="collection-description"
                className="block text-xs font-semibold text-slate-700"
              >
                Scope Description (Optional)
              </label>
              <input
                id="collection-description"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Handbooks, examination ordinances, fee circulars..."
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          {formError && <p className="text-sm text-red-700">{formError}</p>}

          <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={() => onToggleCreateForm(false)}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] w-full rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-slate-300 sm:w-auto"
            >
              {submitting ? 'Saving...' : 'Save Collection'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading collections...
        </div>
      ) : collections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-10">
          <FolderOpen className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">
            No institutional collections registered
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
            Create a school or college collection to upload and organize academic
            handbooks, examination rules, and fee policies.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {collections.map((collection) => {
            const isSelected = collection.id === selectedCollectionId;
            return (
              <article
                key={collection.id}
                className={`min-w-0 rounded-xl border bg-white p-4 transition-colors sm:p-5 ${
                  isSelected ? 'border-blue-700' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {collection.institutionType === 'school' ? 'School' : 'College'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {collection.documentCount}{' '}
                        {collection.documentCount === 1 ? 'PDF' : 'PDFs'}
                      </span>
                    </div>
                    <h2 className="mt-1.5 text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">
                      {collection.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectCollection(collection.id)}
                    className={`min-h-[44px] rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'bg-blue-700 text-white'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isSelected ? 'Selected' : 'Select'}
                  </button>
                </div>

                {collection.description && (
                  <p className="mt-2 text-sm text-slate-600 [overflow-wrap:anywhere]">
                    {collection.description}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => onManageDocuments(collection.id)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:border-blue-700 hover:text-blue-700 whitespace-nowrap shrink-0"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    Manage Documents
                  </button>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {collection.id.slice(0, 8)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
