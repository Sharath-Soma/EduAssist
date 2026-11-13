import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RetrievedChunk, StoredVectorRecord } from '../../shared/types/knowledge.ts';
import type { VectorSearchParams, VectorStorageAdapter } from './interfaces.ts';

interface VectorCollectionIndex {
  collectionId: string;
  updatedAt: string;
  vectors: StoredVectorRecord[];
}

interface CachedVectorEntry {
  record: StoredVectorRecord;
  norm: number;
}

interface CachedCollectionIndex {
  collectionId: string;
  updatedAt: string;
  vectors: StoredVectorRecord[];
  entries: CachedVectorEntry[];
}

function computeNorm(vec: number[]): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarityWithNorms(
  a: number[],
  normA: number,
  b: number[],
  normB: number,
): number {
  if (a.length === 0 || a.length !== b.length || normA === 0 || normB === 0) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot / (normA * normB);
}

function normalizeTextForDedup(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Persistent filesystem-backed vector index isolated per institution collection.
 * Stores one JSON index file per collection under <baseDir>/vectors/<collectionId>.json
 * using serialized per-collection queues, atomic temp-file writes, and an invalidated
 * in-memory norm cache to avoid redundant disk reads and repeated square-root math.
 */
export class LocalFileSystemVectorStore implements VectorStorageAdapter {
  private readonly vectorsDir: string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly indexCache = new Map<string, CachedCollectionIndex>();

  constructor(baseDir: string) {
    this.vectorsDir = path.join(baseDir, 'vectors');
  }

  private enqueue<T>(collectionId: string, operation: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(collectionId) ?? Promise.resolve();
    const next = prev.then(operation, operation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(collectionId, settled);
    return next;
  }

  private getCollectionIndexPath(collectionId: string): string {
    const safeId = path.basename(collectionId);
    if (!safeId || safeId !== collectionId) {
      throw new Error('Invalid collectionId for vector index path.');
    }
    return path.join(this.vectorsDir, `${safeId}.json`);
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.vectorsDir, { recursive: true });
  }

  private buildCachedIndex(index: VectorCollectionIndex): CachedCollectionIndex {
    const entries: CachedVectorEntry[] = index.vectors.map((record) => ({
      record,
      norm: Array.isArray(record.embedding) ? computeNorm(record.embedding) : 0,
    }));
    return {
      collectionId: index.collectionId,
      updatedAt: index.updatedAt,
      vectors: index.vectors,
      entries,
    };
  }

  private async readCollectionIndex(collectionId: string): Promise<CachedCollectionIndex> {
    const cached = this.indexCache.get(collectionId);
    if (cached) {
      return cached;
    }

    const filePath = this.getCollectionIndexPath(collectionId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<VectorCollectionIndex>;
      const built = this.buildCachedIndex({
        collectionId,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
        vectors: Array.isArray(parsed.vectors) ? parsed.vectors : [],
      });
      this.indexCache.set(collectionId, built);
      return built;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const empty = this.buildCachedIndex({
          collectionId,
          updatedAt: new Date().toISOString(),
          vectors: [],
        });
        this.indexCache.set(collectionId, empty);
        return empty;
      }
      throw error;
    }
  }

  private async writeCollectionIndexAtomic(index: VectorCollectionIndex): Promise<void> {
    await this.ensureDirectory();
    const targetPath = this.getCollectionIndexPath(index.collectionId);
    const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(index), 'utf8');
    await fs.rename(tempPath, targetPath);
    this.indexCache.set(index.collectionId, this.buildCachedIndex(index));
  }

  async replaceDocumentVectors(
    collectionId: string,
    documentId: string,
    vectors: StoredVectorRecord[],
  ): Promise<void> {
    await this.enqueue(collectionId, async () => {
      const index = await this.readCollectionIndex(collectionId);
      const preserved = index.vectors.filter((vec) => vec.documentId !== documentId);

      const dedupedIncoming: StoredVectorRecord[] = [];
      const seenChunkIds = new Set<string>();
      for (const vector of vectors) {
        if (vector.collectionId !== collectionId || vector.documentId !== documentId) {
          continue;
        }
        if (seenChunkIds.has(vector.chunkId)) {
          continue;
        }
        seenChunkIds.add(vector.chunkId);
        dedupedIncoming.push(vector);
      }

      await this.writeCollectionIndexAtomic({
        collectionId,
        updatedAt: new Date().toISOString(),
        vectors: [...preserved, ...dedupedIncoming],
      });
    });
  }

  async getVectorsByCollection(collectionId: string): Promise<StoredVectorRecord[]> {
    const index = await this.readCollectionIndex(collectionId);
    return index.vectors;
  }

  async getDocumentVectorCount(collectionId: string, documentId: string): Promise<number> {
    const index = await this.readCollectionIndex(collectionId);
    return index.vectors.filter((vec) => vec.documentId === documentId).length;
  }

  async deleteDocumentVectors(collectionId: string, documentId: string): Promise<number> {
    return this.enqueue(collectionId, async () => {
      const index = await this.readCollectionIndex(collectionId);
      const remaining = index.vectors.filter((vec) => vec.documentId !== documentId);
      const removedCount = index.vectors.length - remaining.length;

      if (removedCount === 0) {
        return 0;
      }

      if (remaining.length === 0) {
        await this.deleteCollectionIndexFile(collectionId);
      } else {
        await this.writeCollectionIndexAtomic({
          collectionId,
          updatedAt: new Date().toISOString(),
          vectors: remaining,
        });
      }

      return removedCount;
    });
  }

  private async deleteCollectionIndexFile(collectionId: string): Promise<void> {
    this.indexCache.delete(collectionId);
    const filePath = this.getCollectionIndexPath(collectionId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async deleteCollectionVectors(collectionId: string): Promise<void> {
    await this.enqueue(collectionId, async () => {
      await this.deleteCollectionIndexFile(collectionId);
    });
  }

  async similaritySearch(params: VectorSearchParams): Promise<RetrievedChunk[]> {
    const index = await this.readCollectionIndex(params.collectionId);
    const minScore = params.minScore ?? 0;
    const targetDimensions = params.queryEmbedding.length;
    const queryNorm = computeNorm(params.queryEmbedding);
    if (queryNorm === 0) {
      return [];
    }

    const scored: Array<{ record: StoredVectorRecord; score: number }> = [];
    for (const { record, norm } of index.entries) {
      if (record.collectionId !== params.collectionId) {
        continue;
      }
      if (params.allowedDocumentIds && !params.allowedDocumentIds.has(record.documentId)) {
        continue;
      }
      if (!Array.isArray(record.embedding) || record.embedding.length !== targetDimensions) {
        continue;
      }
      const score = cosineSimilarityWithNorms(
        params.queryEmbedding,
        queryNorm,
        record.embedding,
        norm,
      );
      if (score >= minScore) {
        scored.push({ record, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const results: RetrievedChunk[] = [];
    const seenChunkIds = new Set<string>();
    const seenNormalizedTexts = new Set<string>();

    for (const { record, score } of scored) {
      if (results.length >= params.topK) {
        break;
      }
      if (seenChunkIds.has(record.chunkId)) {
        continue;
      }
      const normalized = normalizeTextForDedup(record.text);
      if (seenNormalizedTexts.has(normalized)) {
        continue;
      }

      seenChunkIds.add(record.chunkId);
      seenNormalizedTexts.add(normalized);

      results.push({
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
      });
    }

    return results;
  }
}
