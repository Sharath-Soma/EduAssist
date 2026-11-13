import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AcademicTrack,
  DocumentRecord,
  InstitutionCollection,
} from '../../shared/types/knowledge.ts';
import {
  deleteCollectionDocument,
  fetchCollectionDocuments,
  fetchDocumentIngestionStatus,
  ingestCollectionDocument,
  uploadCollectionDocument,
} from '../services/apiClient.ts';

const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024;

const TRACK_LABELS: Record<AcademicTrack, string> = {
  classes_6_8: 'Classes 6–8',
  classes_9_10: 'Classes 9–10',
  classes_11_12: 'Classes 11–12',
  degree: 'Degree Programs',
  btech_engineering: 'B.Tech & Engineering',
};

interface CollectionDocumentsViewProps {
  collection: InstitutionCollection;
  onBackToCollections: () => void;
  onCollectionUpdated: (collection: InstitutionCollection) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUploadDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DocumentStatusText({ doc }: { doc: DocumentRecord }) {
  if (doc.status === 'indexed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Indexed
      </span>
    );
  }

  if (doc.status === 'processing') {
    const progress =
      doc.ingestion && doc.ingestion.totalChunks > 0
        ? ` (${doc.ingestion.embeddedChunks}/${doc.ingestion.totalChunks})`
        : '';
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Processing{progress}
      </span>
    );
  }

  if (doc.status === 'ingestion_failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Failed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Pending ingestion
    </span>
  );
}

function formatProcessingResults(doc: DocumentRecord): string {
  const meta = doc.ingestion;
  if (!meta && doc.pageCount === null) {
    return '—';
  }

  if (doc.status === 'indexed' && meta) {
    return `${meta.extractedPages}/${meta.totalPages} pages · ${meta.totalChunks} chunks`;
  }

  if (doc.status === 'processing' && meta) {
    if (meta.totalChunks > 0) {
      return `${meta.totalPages} pages · ${meta.embeddedChunks}/${meta.totalChunks} chunks`;
    }
    return meta.totalPages > 0 ? `${meta.totalPages} pages` : 'Extracting...';
  }

  if (doc.status === 'ingestion_failed' && meta) {
    if (meta.totalPages > 0) {
      return `${meta.extractedPages}/${meta.totalPages} pages · ${meta.totalChunks} chunks`;
    }
    return '0 pages extracted';
  }

  return doc.pageCount !== null ? `${doc.pageCount} pages` : '—';
}

export function CollectionDocumentsView({
  collection,
  onBackToCollections,
  onCollectionUpdated,
}: CollectionDocumentsViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [collectionDetails, setCollectionDetails] =
    useState<InstitutionCollection>(collection);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFilename, setUploadingFilename] = useState<string | null>(null);

  const [ingestingIds, setIngestingIds] = useState<Set<string>>(() => new Set());

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<DocumentRecord | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await fetchCollectionDocuments(collection.id);
      setCollectionDetails(result.collection);
      setDocuments(result.documents);
      onCollectionUpdated(result.collection);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load documents for this collection.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [collection.id, onCollectionUpdated]);

  useEffect(() => {
    setCollectionDetails(collection);
    void loadDocuments();
  }, [collection.id, loadDocuments]);

  // Poll status for any document currently in 'processing' state
  useEffect(() => {
    const processingDocs = documents.filter((doc) => doc.status === 'processing');
    if (processingDocs.length === 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      for (const doc of processingDocs) {
        void fetchDocumentIngestionStatus(collectionDetails.id, doc.id)
          .then((statusResponse) => {
            setDocuments((prev) =>
              prev.map((item) =>
                item.id === statusResponse.document.id ? statusResponse.document : item,
              ),
            );
          })
          .catch(() => {
            // Keep polling silently; explicit errors show on action completion
          });
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [collectionDetails.id, documents]);

  const validateSelectedFile = async (file: File): Promise<string | null> => {
    const hasPdfExtension = file.name.toLowerCase().endsWith('.pdf');
    const hasValidMime =
      file.type === '' ||
      file.type === 'application/pdf' ||
      file.type === 'application/x-pdf';

    if (!hasPdfExtension || !hasValidMime) {
      return 'Only PDF files (.pdf) are supported.';
    }

    if (file.size === 0) {
      return 'The selected PDF file is empty (0 bytes).';
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      return 'PDF exceeds the maximum allowed size of 25 MB.';
    }

    const headerSlice = await file.slice(0, 5).text();
    if (headerSlice !== '%PDF-') {
      return 'The selected file does not have a valid PDF header (%PDF-).';
    }

    const normalizedName = file.name.trim().toLowerCase();
    const duplicateByName = documents.find(
      (doc) => doc.filename.trim().toLowerCase() === normalizedName,
    );
    if (duplicateByName) {
      return `A document named "${duplicateByName.filename}" is already in this collection.`;
    }

    return null;
  };

  const handleFileUpload = async (file: File) => {
    if (isUploading) {
      return;
    }

    setFeedback(null);
    const validationError = await validateSelectedFile(file);
    if (validationError) {
      setFeedback({ type: 'error', message: validationError });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadingFilename(file.name);

    try {
      const result = await uploadCollectionDocument(
        collectionDetails.id,
        file,
        (percent) => setUploadProgress(percent),
      );
      setDocuments((prev) => [result.document, ...prev]);
      setCollectionDetails(result.collection);
      onCollectionUpdated(result.collection);
      setFeedback({
        type: 'success',
        message: `"${result.document.filename}" uploaded and marked as Pending ingestion.`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to upload PDF document.',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadingFilename(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleProcessDocument = async (doc: DocumentRecord) => {
    if (ingestingIds.has(doc.id) || doc.status === 'processing') {
      return;
    }

    setFeedback(null);
    setIngestingIds((prev) => {
      const next = new Set(prev);
      next.add(doc.id);
      return next;
    });
    setDocuments((prev) =>
      prev.map((item) =>
        item.id === doc.id ? { ...item, status: 'processing' } : item,
      ),
    );

    try {
      const result = await ingestCollectionDocument(collectionDetails.id, doc.id);
      setDocuments((prev) =>
        prev.map((item) => (item.id === result.document.id ? result.document : item)),
      );
      const totalPages = result.document.ingestion?.totalPages ?? result.document.pageCount ?? 0;
      const totalChunks = result.document.ingestion?.totalChunks ?? result.vectorCount;
      setFeedback({
        type: 'success',
        message: `"${result.document.filename}" indexed (${totalPages} pages, ${totalChunks} chunks, ${result.vectorCount} vectors stored).`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Document ingestion failed.';
      try {
        const latest = await fetchDocumentIngestionStatus(collectionDetails.id, doc.id);
        setDocuments((prev) =>
          prev.map((item) =>
            item.id === latest.document.id ? latest.document : item,
          ),
        );
      } catch {
        setDocuments((prev) =>
          prev.map((item) =>
            item.id === doc.id ? { ...item, status: 'ingestion_failed' } : item,
          ),
        );
      }
      setFeedback({ type: 'error', message });
    } finally {
      setIngestingIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const handleFileList = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }
    if (fileList.length > 1) {
      setFeedback({
        type: 'error',
        message: 'Upload one PDF document at a time to ensure accurate validation.',
      });
      return;
    }
    void handleFileUpload(fileList[0]);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    handleFileList(event.dataTransfer.files);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteDoc) {
      return;
    }
    const target = pendingDeleteDoc;
    setIsDeletingId(target.id);
    setFeedback(null);

    try {
      const result = await deleteCollectionDocument(collectionDetails.id, target.id);
      setDocuments((prev) => prev.filter((doc) => doc.id !== target.id));
      setCollectionDetails(result.collection);
      onCollectionUpdated(result.collection);
      setPendingDeleteDoc(null);
      setFeedback({
        type: 'success',
        message: `"${target.filename}" and ${result.removedVectors} associated vector(s) were deleted from ${collectionDetails.name}.`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to delete document.',
      });
    } finally {
      setIsDeletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="border-b border-slate-200 pb-5">
        <button
          type="button"
          onClick={onBackToCollections}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Collections
        </button>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {collectionDetails.institutionType === 'school' ? 'School' : 'College'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{TRACK_LABELS[collectionDetails.academicTrack]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {collectionDetails.documentCount}{' '}
                {collectionDetails.documentCount === 1 ? 'document' : 'documents'}
              </span>
            </div>
            <h1 className="mt-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl [overflow-wrap:anywhere]">
              {collectionDetails.name}
            </h1>
            {collectionDetails.description && (
              <p className="mt-1 text-sm text-slate-600 [overflow-wrap:anywhere]">
                {collectionDetails.description}
              </p>
            )}
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
            ID: {collectionDetails.id.slice(0, 8)}
          </span>
        </div>
      </div>

      <section aria-label="Upload PDF document">
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors sm:p-8 ${
            isDragging
              ? 'border-blue-700 bg-blue-50/50'
              : 'border-slate-300 bg-white hover:border-slate-400'
          }`}
        >
          <Upload className="mx-auto h-8 w-8 text-slate-500" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">
            Upload Institutional PDF
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Drag and drop an official handbook, syllabus, or circular here, or browse
            from your device.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PDF files only (.pdf) · Maximum size 25 MB · Duplicate files prevented
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => handleFileList(event.target.files)}
            className="sr-only"
            aria-label="Select PDF file to upload"
          />

          <div className="mt-5">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {isUploading ? 'Uploading PDF...' : 'Browse PDF Files'}
            </button>
          </div>

          {isUploading && (
            <div className="mx-auto mt-5 max-w-md space-y-1.5 text-left">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span className="truncate font-medium">
                  {uploadingFilename ?? 'Uploading...'}
                </span>
                <span className="font-mono tabular-nums shrink-0">{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-blue-700 transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            {feedback.type === 'error' ? (
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
                aria-hidden="true"
              />
            )}
            <p className="[overflow-wrap:anywhere]">{feedback.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="min-h-[36px] text-xs font-medium underline hover:opacity-80 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {pendingDeleteDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <div className="min-w-0 flex-1">
            <h3
              id="confirm-delete-title"
              className="text-sm font-semibold text-red-950 [overflow-wrap:anywhere]"
            >
              Delete "{pendingDeleteDoc.filename}"?
            </h3>
            <p className="mt-0.5 text-xs text-red-800 [overflow-wrap:anywhere]">
              This permanently removes the uploaded PDF file, metadata, and any indexed
              vectors from {collectionDetails.name}.
            </p>
          </div>
          <div className="flex w-full items-center gap-2.5 sm:w-auto shrink-0">
            <button
              type="button"
              disabled={isDeletingId !== null}
              onClick={() => setPendingDeleteDoc(null)}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeletingId !== null}
              onClick={() => void handleConfirmDelete()}
              className="min-h-[44px] flex-1 rounded-lg bg-red-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-red-800 disabled:bg-red-300 sm:flex-none"
            >
              {isDeletingId === pendingDeleteDoc.id ? 'Deleting...' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      )}

      <section aria-label="Uploaded documents" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Uploaded Documents
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {documents.length} {documents.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            {loadError}
          </div>
        ) : isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading uploaded documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-10">
            <FileText className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-slate-900">
              No PDFs uploaded to this collection yet
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
              Upload official school or college PDFs above, then process each document
              to extract pages, chunk text, and store vector embeddings.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {documents.map((doc) => {
                const isBusy = doc.status === 'processing' || ingestingIds.has(doc.id);

                return (
                  <article
                    key={doc.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <FileText
                          className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">
                            {doc.filename}
                          </p>
                          <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {doc.id.slice(0, 8)} · {formatFileSize(doc.sizeBytes)}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0">
                        <DocumentStatusText doc={doc} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 tabular-nums">
                      <span>{formatUploadDate(doc.uploadedAt)}</span>
                      <span className="font-mono">{formatProcessingResults(doc)}</span>
                    </div>

                    {doc.status === 'ingestion_failed' && doc.ingestion?.errorMessage && (
                      <p className="text-xs text-red-700 [overflow-wrap:anywhere]">
                        {doc.ingestion.errorMessage}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      {doc.status === 'pending_ingestion' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleProcessDocument(doc)}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:bg-slate-300"
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          Process Document
                        </button>
                      )}

                      {doc.status === 'ingestion_failed' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleProcessDocument(doc)}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Retry Ingestion
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setPendingDeleteDoc(doc)}
                        disabled={isBusy || isDeletingId === doc.id}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Document Name</th>
                    <th className="px-4 py-3">File Size</th>
                    <th className="px-4 py-3">Upload Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Pages &amp; Chunks</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {documents.map((doc) => {
                    const isBusy =
                      doc.status === 'processing' || ingestingIds.has(doc.id);

                    return (
                      <tr key={doc.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2.5">
                            <FileText
                              className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">
                                {doc.filename}
                              </p>
                              <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                                {doc.id.slice(0, 8)}
                              </p>
                              {doc.status === 'ingestion_failed' &&
                                doc.ingestion?.errorMessage && (
                                  <p className="mt-1 max-w-md text-xs text-red-700 [overflow-wrap:anywhere]">
                                    {doc.ingestion.errorMessage}
                                  </p>
                                )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatFileSize(doc.sizeBytes)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatUploadDate(doc.uploadedAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <DocumentStatusText doc={doc} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatProcessingResults(doc)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            {doc.status === 'pending_ingestion' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleProcessDocument(doc)}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:bg-slate-300"
                              >
                                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                Process Document
                              </button>
                            )}

                            {doc.status === 'ingestion_failed' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleProcessDocument(doc)}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50"
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                Retry Ingestion
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setPendingDeleteDoc(doc)}
                              disabled={isBusy || isDeletingId === doc.id}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
