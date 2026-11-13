import type {
  InstitutionCollection,
  RetrievedChunk,
} from '../../../shared/types/knowledge.ts';
import { getDocumentStore, getVectorStore } from '../../storage/storeFactory.ts';
import { textEmbedder } from './embedder.ts';

export const DEFAULT_RETRIEVAL_TOP_K = (() => {
  const parsed = Number(process.env.RAG_TOP_K ?? '4');
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? Math.round(parsed) : 4;
})();

export const DEFAULT_MIN_SIMILARITY = (() => {
  const parsed = Number(process.env.RAG_MIN_SIMILARITY ?? '0.45');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.45;
})();

export class CollectionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'CollectionNotFoundError';
  }
}

export interface RetrievalRequest {
  collectionId: string;
  query: string;
  topK?: number;
  minScore?: number;
  preloadedCollection?: InstitutionCollection;
  preloadedIndexedDocIds?: Set<string>;
}

export interface RetrievalResult {
  collection: InstitutionCollection;
  indexedDocumentCount: number;
  chunks: RetrievedChunk[];
  topK: number;
  minScore: number;
}

export interface VectorRetriever {
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}

export class CollectionVectorRetriever implements VectorRetriever {
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const documentStore = getDocumentStore();
    const vectorStore = getVectorStore();

    const collection =
      request.preloadedCollection ??
      (await documentStore.getCollectionById(request.collectionId));
    if (!collection) {
      throw new CollectionNotFoundError('Selected institution collection was not found.');
    }

    const topK = Math.max(1, Math.min(5, request.topK ?? DEFAULT_RETRIEVAL_TOP_K));
    const minScore =
      typeof request.minScore === 'number' &&
      request.minScore >= 0 &&
      request.minScore <= 1
        ? request.minScore
        : DEFAULT_MIN_SIMILARITY;

    let allowedDocumentIds = request.preloadedIndexedDocIds;
    if (!allowedDocumentIds) {
      const documents = await documentStore.listDocumentsByCollection(collection.id);
      allowedDocumentIds = new Set(
        documents.filter((doc) => doc.status === 'indexed').map((doc) => doc.id),
      );
    }

    if (allowedDocumentIds.size === 0) {
      return {
        collection,
        indexedDocumentCount: 0,
        chunks: [],
        topK,
        minScore,
      };
    }

    const queryEmbedding = await textEmbedder.embedQuery(request.query);

    const chunks = await vectorStore.similaritySearch({
      collectionId: collection.id,
      queryEmbedding,
      topK,
      minScore,
      allowedDocumentIds,
    });

    const enrichedChunks = chunks.map((chunk) => ({
      ...chunk,
      collectionName: collection.name,
    }));

    return {
      collection,
      indexedDocumentCount: allowedDocumentIds.size,
      chunks: enrichedChunks,
      topK,
      minScore,
    };
  }
}

export const vectorRetriever: VectorRetriever = new CollectionVectorRetriever();
