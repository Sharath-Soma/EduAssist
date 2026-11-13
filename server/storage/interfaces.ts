import type {
  CreateCollectionInput,
  DocumentRecord,
  InstitutionCollection,
  RetrievedChunk,
  StoredVectorRecord,
} from '../../shared/types/knowledge.ts';

export interface VectorSearchParams {
  collectionId: string;
  queryEmbedding: number[];
  topK: number;
  minScore?: number;
  allowedDocumentIds?: Set<string>;
}

export interface DuplicateCheckParams {
  filename: string;
  sha256: string;
}

export interface StoreDocumentFileParams {
  collectionId: string;
  documentId: string;
  buffer: Buffer;
}

export interface DocumentStorageAdapter {
  listCollections(): Promise<InstitutionCollection[]>;
  getCollectionById(collectionId: string): Promise<InstitutionCollection | null>;
  createCollection(input: CreateCollectionInput): Promise<InstitutionCollection>;
  listDocumentsByCollection(collectionId: string): Promise<DocumentRecord[]>;
  getDocumentById(documentId: string): Promise<DocumentRecord | null>;
  findDuplicateDocument(
    collectionId: string,
    params: DuplicateCheckParams,
  ): Promise<DocumentRecord | null>;
  storeDocumentFile(params: StoreDocumentFileParams): Promise<string>;
  readDocumentFile(storageKey: string): Promise<Buffer>;
  saveDocumentMetadata(record: DocumentRecord): Promise<DocumentRecord>;
  deleteDocument(documentId: string): Promise<DocumentRecord | null>;
}

export interface VectorStorageAdapter {
  replaceDocumentVectors(
    collectionId: string,
    documentId: string,
    vectors: StoredVectorRecord[],
  ): Promise<void>;
  getVectorsByCollection(collectionId: string): Promise<StoredVectorRecord[]>;
  getDocumentVectorCount(collectionId: string, documentId: string): Promise<number>;
  deleteDocumentVectors(collectionId: string, documentId: string): Promise<number>;
  deleteCollectionVectors(collectionId: string): Promise<void>;
  similaritySearch(params: VectorSearchParams): Promise<RetrievedChunk[]>;
}
