import crypto from 'node:crypto';
import type {
  CreateCollectionInput,
  DocumentRecord,
  InstitutionCollection,
  RetrievedChunk,
  StoredVectorRecord,
} from '../../shared/types/knowledge.ts';
import type {
  DocumentStorageAdapter,
  DuplicateCheckParams,
  StoreDocumentFileParams,
  VectorSearchParams,
  VectorStorageAdapter,
} from './interfaces.ts';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * In-memory scaffold adapter implementing the storage contracts for transient tests.
 */
export class MemoryScaffoldStore implements DocumentStorageAdapter, VectorStorageAdapter {
  private readonly collections = new Map<string, InstitutionCollection>();
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly fileBuffers = new Map<string, Buffer>();
  private readonly vectorsByCollection = new Map<string, StoredVectorRecord[]>();

  async listCollections(): Promise<InstitutionCollection[]> {
    return Array.from(this.collections.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async getCollectionById(collectionId: string): Promise<InstitutionCollection | null> {
    return this.collections.get(collectionId) ?? null;
  }

  async createCollection(input: CreateCollectionInput): Promise<InstitutionCollection> {
    const collection: InstitutionCollection = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      institutionType: input.institutionType,
      academicTrack: input.academicTrack,
      description: (input.description ?? '').trim(),
      documentCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.collections.set(collection.id, collection);
    return collection;
  }

  async listDocumentsByCollection(collectionId: string): Promise<DocumentRecord[]> {
    return Array.from(this.documents.values())
      .filter((doc) => doc.collectionId === collectionId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async getDocumentById(documentId: string): Promise<DocumentRecord | null> {
    return this.documents.get(documentId) ?? null;
  }

  async findDuplicateDocument(
    collectionId: string,
    params: DuplicateCheckParams,
  ): Promise<DocumentRecord | null> {
    const normalizedName = params.filename.trim().toLowerCase();
    for (const doc of this.documents.values()) {
      if (doc.collectionId !== collectionId) {
        continue;
      }
      if (
        doc.sha256 === params.sha256 ||
        doc.filename.trim().toLowerCase() === normalizedName
      ) {
        return doc;
      }
    }
    return null;
  }

  async storeDocumentFile(params: StoreDocumentFileParams): Promise<string> {
    const storageKey = `memory://${params.collectionId}/${params.documentId}.pdf`;
    this.fileBuffers.set(storageKey, params.buffer);
    return storageKey;
  }

  async readDocumentFile(storageKey: string): Promise<Buffer> {
    const buffer = this.fileBuffers.get(storageKey);
    if (!buffer) {
      throw new Error(`Document binary not found for storage key: ${storageKey}`);
    }
    return buffer;
  }

  async saveDocumentMetadata(record: DocumentRecord): Promise<DocumentRecord> {
    this.documents.set(record.id, record);
    this.refreshCollectionCount(record.collectionId);
    return record;
  }

  async deleteDocument(documentId: string): Promise<DocumentRecord | null> {
    const existing = this.documents.get(documentId);
    if (!existing) {
      return null;
    }

    this.documents.delete(documentId);
    this.fileBuffers.delete(existing.storageKey);
    this.refreshCollectionCount(existing.collectionId);
    return existing;
  }

  private refreshCollectionCount(collectionId: string): void {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      return;
    }
    const count = Array.from(this.documents.values()).filter(
      (doc) => doc.collectionId === collectionId,
    ).length;
    this.collections.set(collection.id, {
      ...collection,
      documentCount: count,
    });
  }

  async replaceDocumentVectors(
    collectionId: string,
    documentId: string,
    vectors: StoredVectorRecord[],
  ): Promise<void> {
    const existing = this.vectorsByCollection.get(collectionId) ?? [];
    const preserved = existing.filter((vec) => vec.documentId !== documentId);
    this.vectorsByCollection.set(collectionId, [...preserved, ...vectors]);
  }

  async getVectorsByCollection(collectionId: string): Promise<StoredVectorRecord[]> {
    return this.vectorsByCollection.get(collectionId) ?? [];
  }

  async getDocumentVectorCount(collectionId: string, documentId: string): Promise<number> {
    const existing = this.vectorsByCollection.get(collectionId) ?? [];
    return existing.filter((vec) => vec.documentId === documentId).length;
  }

  async deleteDocumentVectors(collectionId: string, documentId: string): Promise<number> {
    const existing = this.vectorsByCollection.get(collectionId) ?? [];
    const remaining = existing.filter((vec) => vec.documentId !== documentId);
    this.vectorsByCollection.set(collectionId, remaining);
    return existing.length - remaining.length;
  }

  async similaritySearch(params: VectorSearchParams): Promise<RetrievedChunk[]> {
    const existing = this.vectorsByCollection.get(params.collectionId) ?? [];
    const minScore = params.minScore ?? 0;
    const targetDimensions = params.queryEmbedding.length;

    return existing
      .filter((record) => {
        if (record.collectionId !== params.collectionId) {
          return false;
        }
        if (params.allowedDocumentIds && !params.allowedDocumentIds.has(record.documentId)) {
          return false;
        }
        return Array.isArray(record.embedding) && record.embedding.length === targetDimensions;
      })
      .map((record) => ({
        record,
        score: cosineSimilarity(params.queryEmbedding, record.embedding),
      }))
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, params.topK)
      .map(({ record, score }) => ({
        vectorId: record.id,
        chunkId: record.chunkId,
        documentId: record.documentId,
        documentName: record.documentName,
        collectionId: record.collectionId,
        collectionName: '',
        pageNumber: record.pageNumber,
        chunkIndex: record.chunkIndex,
        excerpt: record.text,
        similarityScore: score,
      }));
  }

  async deleteCollectionVectors(collectionId: string): Promise<void> {
    this.vectorsByCollection.delete(collectionId);
  }
}
