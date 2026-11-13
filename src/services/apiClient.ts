import type {
  AssistantQueryRequest,
  AssistantQueryResponse,
  AssistantStreamEvent,
  CreateCollectionInput,
  DocumentIngestionStatusResponse,
  DocumentRecord,
  InstitutionCollection,
  SystemHealthResponse,
} from '../../shared/types/knowledge.ts';

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`);
  }
  return data;
}

export async function fetchSystemHealth(): Promise<SystemHealthResponse> {
  const response = await fetch('/api/health');
  return parseJsonResponse<SystemHealthResponse>(response);
}

export async function fetchCollections(): Promise<InstitutionCollection[]> {
  const response = await fetch('/api/collections');
  const data = await parseJsonResponse<{ collections: InstitutionCollection[] }>(response);
  return data.collections;
}

export async function createCollection(
  input: CreateCollectionInput,
): Promise<InstitutionCollection> {
  const response = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ collection: InstitutionCollection }>(response);
  return data.collection;
}

export async function fetchCollectionDocuments(collectionId: string): Promise<{
  collection: InstitutionCollection;
  documents: DocumentRecord[];
}> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/documents`,
  );
  return parseJsonResponse<{
    collection: InstitutionCollection;
    documents: DocumentRecord[];
  }>(response);
}

export async function fetchDocumentMetadata(
  collectionId: string,
  documentId: string,
): Promise<DocumentRecord> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
  );
  const data = await parseJsonResponse<{ document: DocumentRecord }>(response);
  return data.document;
}

export function uploadCollectionDocument(
  collectionId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ document: DocumentRecord; collection: InstitutionCollection }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `/api/collections/${encodeURIComponent(collectionId)}/documents`,
    );

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText) as {
          document?: DocumentRecord;
          collection?: InstitutionCollection;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && parsed.document && parsed.collection) {
          onProgress(100);
          resolve({
            document: parsed.document,
            collection: parsed.collection,
          });
          return;
        }
        reject(new Error(parsed.error ?? `Upload failed with status ${xhr.status}.`));
      } catch {
        reject(new Error(`Upload failed with status ${xhr.status}.`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error occurred while uploading the PDF.'));
    };

    xhr.onabort = () => {
      reject(new Error('PDF upload was cancelled.'));
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export async function ingestCollectionDocument(
  collectionId: string,
  documentId: string,
): Promise<DocumentIngestionStatusResponse> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/ingest`,
    {
      method: 'POST',
    },
  );
  return parseJsonResponse<DocumentIngestionStatusResponse>(response);
}

export async function fetchDocumentIngestionStatus(
  collectionId: string,
  documentId: string,
): Promise<DocumentIngestionStatusResponse> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/ingestion`,
  );
  return parseJsonResponse<DocumentIngestionStatusResponse>(response);
}

export async function deleteCollectionDocument(
  collectionId: string,
  documentId: string,
): Promise<{
  deletedDocument: DocumentRecord | null;
  removedVectors: number;
  collection: InstitutionCollection;
}> {
  const response = await fetch(
    `/api/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
    {
      method: 'DELETE',
    },
  );
  return parseJsonResponse<{
    deletedDocument: DocumentRecord | null;
    removedVectors: number;
    collection: InstitutionCollection;
  }>(response);
}

export async function submitAssistantQuery(
  payload: AssistantQueryRequest,
): Promise<AssistantQueryResponse> {
  const response = await fetch('/api/assistant/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<AssistantQueryResponse>(response);
}

export async function streamAssistantQuery(
  payload: AssistantQueryRequest,
  onEvent: (event: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<AssistantQueryResponse> {
  const response = await fetch('/api/assistant/query/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // Fallback to HTTP status message
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('Streaming response body is unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: AssistantQueryResponse | null = null;

  const processFrame = (rawFrame: string) => {
    const lines = rawFrame.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) {
      return;
    }
    const parsed = JSON.parse(dataLines.join('\n')) as AssistantStreamEvent;
    onEvent(parsed);
    if (parsed.type === 'done') {
      finalResponse = parsed.response;
    } else if (parsed.type === 'error') {
      throw new Error(parsed.error);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let separatorIdx = buffer.indexOf('\n\n');
    while (separatorIdx !== -1) {
      const frame = buffer.slice(0, separatorIdx);
      buffer = buffer.slice(separatorIdx + 2);
      if (frame.trim()) {
        processFrame(frame);
      }
      separatorIdx = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processFrame(buffer);
  }

  if (!finalResponse) {
    throw new Error('Assistant stream ended before delivering a final response.');
  }

  return finalResponse;
}
