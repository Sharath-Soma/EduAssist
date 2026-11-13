import crypto from 'node:crypto';
import type {
  DocumentRecord,
  IngestionMetadata,
  StoredVectorRecord,
} from '../../../shared/types/knowledge.ts';
import { getDocumentStore, getVectorStore } from '../../storage/storeFactory.ts';
import { pdfExtractor, PdfExtractionError } from '../pdf/pdfProcessor.ts';
import { DEFAULT_CHUNKING_OPTIONS, documentChunker } from './chunker.ts';
import { textEmbedder } from './embedder.ts';

export class IngestionConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'IngestionConflictError';
  }
}

export class IngestionNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'IngestionNotFoundError';
  }
}

export interface IngestionResult {
  document: DocumentRecord;
  vectorCount: number;
}

const activeDocumentIngestions = new Set<string>();

export function isDocumentActivelyProcessing(documentId: string): boolean {
  return activeDocumentIngestions.has(documentId);
}

export async function ingestCollectionDocument(
  collectionId: string,
  documentId: string,
): Promise<IngestionResult> {
  const documentStore = getDocumentStore();
  const vectorStore = getVectorStore();

  const collection = await documentStore.getCollectionById(collectionId);
  if (!collection) {
    throw new IngestionNotFoundError('Collection not found.');
  }

  const existingDoc = await documentStore.getDocumentById(documentId);
  if (!existingDoc || existingDoc.collectionId !== collection.id) {
    throw new IngestionNotFoundError('Document not found in this collection.');
  }

  if (activeDocumentIngestions.has(existingDoc.id)) {
    throw new IngestionConflictError(
      `Document "${existingDoc.filename}" is already being processed.`,
    );
  }

  activeDocumentIngestions.add(existingDoc.id);
  const startedAt = new Date().toISOString();

  let currentIngestion: IngestionMetadata = {
    totalPages: existingDoc.pageCount ?? 0,
    extractedPages: 0,
    emptyPages: 0,
    totalChunks: 0,
    embeddedChunks: 0,
    embeddingModel: textEmbedder.model,
    embeddingDimensions: textEmbedder.dimensions,
    startedAt,
    completedAt: null,
    errorMessage: null,
  };

  try {
    await documentStore.saveDocumentMetadata({
      ...existingDoc,
      status: 'processing',
      ingestion: currentIngestion,
    });

    const pdfBuffer = await documentStore.readDocumentFile(existingDoc.storageKey);

    const extraction = await pdfExtractor.extractPages(pdfBuffer, existingDoc.filename);
    currentIngestion = {
      ...currentIngestion,
      totalPages: extraction.totalPages,
      extractedPages: extraction.extractedPages,
      emptyPages: extraction.emptyPages,
    };

    const chunks = documentChunker.chunkDocument({
      documentId: existingDoc.id,
      collectionId: collection.id,
      extraction,
      options: DEFAULT_CHUNKING_OPTIONS,
    });

    if (chunks.length === 0) {
      throw new PdfExtractionError(
        `No text chunks could be produced from "${existingDoc.filename}".`,
        422,
      );
    }

    currentIngestion = {
      ...currentIngestion,
      totalChunks: chunks.length,
    };

    await documentStore.saveDocumentMetadata({
      ...existingDoc,
      pageCount: extraction.totalPages,
      status: 'processing',
      ingestion: currentIngestion,
    });

    const embeddings = await textEmbedder.embedDocumentTexts(
      chunks.map((chunk) => chunk.content),
      {
        title: existingDoc.filename,
        onBatchEmbedded: async (completedCount) => {
          currentIngestion = {
            ...currentIngestion,
            embeddedChunks: completedCount,
          };
          await documentStore.saveDocumentMetadata({
            ...existingDoc,
            pageCount: extraction.totalPages,
            status: 'processing',
            ingestion: currentIngestion,
          });
        },
      },
    );

    const createdAt = new Date().toISOString();
    const vectorRecords: StoredVectorRecord[] = chunks.map((chunk, index) => ({
      id: crypto.randomUUID(),
      collectionId: collection.id,
      documentId: existingDoc.id,
      chunkId: chunk.id,
      documentName: existingDoc.filename,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      text: chunk.content,
      tokenCount: chunk.tokenCount,
      embedding: embeddings[index],
      embeddingModel: textEmbedder.model,
      createdAt,
    }));

    await vectorStore.replaceDocumentVectors(collection.id, existingDoc.id, vectorRecords);

    const completedAt = new Date().toISOString();
    const finalIngestion: IngestionMetadata = {
      ...currentIngestion,
      embeddedChunks: vectorRecords.length,
      completedAt,
      errorMessage: null,
    };

    const indexedDoc = await documentStore.saveDocumentMetadata({
      ...existingDoc,
      pageCount: extraction.totalPages,
      status: 'indexed',
      ingestion: finalIngestion,
    });

    const vectorCount = await vectorStore.getDocumentVectorCount(
      collection.id,
      existingDoc.id,
    );

    return {
      document: indexedDoc,
      vectorCount,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unexpected ingestion failure.';

    await documentStore.saveDocumentMetadata({
      ...existingDoc,
      pageCount:
        currentIngestion.totalPages > 0
          ? currentIngestion.totalPages
          : existingDoc.pageCount,
      status: 'ingestion_failed',
      ingestion: {
        ...currentIngestion,
        completedAt: new Date().toISOString(),
        errorMessage,
      },
    });

    throw error;
  } finally {
    activeDocumentIngestions.delete(existingDoc.id);
  }
}
