export type InstitutionType = 'school' | 'college';

export type AcademicTrack =
  | 'classes_6_8'
  | 'classes_9_10'
  | 'classes_11_12'
  | 'degree'
  | 'btech_engineering';

export type KnowledgeSourceMode = 'dual' | 'institutional' | 'educational';

export type LegacyKnowledgeSourceMode =
  | 'dual_separated'
  | 'institutional_only'
  | 'general_educational';

export type AnyKnowledgeSourceMode = KnowledgeSourceMode | LegacyKnowledgeSourceMode;

export type KnowledgeType =
  | 'institutional'
  | 'educational'
  | 'dual'
  | 'clarification'
  | 'insufficient_evidence';

export type DocumentProcessingStatus =
  | 'pending_ingestion'
  | 'processing'
  | 'indexed'
  | 'ingestion_failed';

export interface IngestionMetadata {
  totalPages: number;
  extractedPages: number;
  emptyPages: number;
  totalChunks: number;
  embeddedChunks: number;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface InstitutionCollection {
  id: string;
  name: string;
  institutionType: InstitutionType;
  academicTrack: AcademicTrack;
  description: string;
  documentCount: number;
  createdAt: string;
}

export interface CreateCollectionInput {
  name: string;
  institutionType: InstitutionType;
  academicTrack: AcademicTrack;
  description?: string;
}

export interface DocumentRecord {
  id: string;
  collectionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number | null;
  storageKey: string;
  status: DocumentProcessingStatus;
  uploadedAt: string;
  ingestion?: IngestionMetadata | null;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  collectionId: string;
  documentName: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export interface StoredVectorRecord {
  id: string;
  collectionId: string;
  documentId: string;
  chunkId: string;
  documentName: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  embedding: number[];
  embeddingModel: string;
  createdAt: string;
}

export interface DocumentIngestionStatusResponse {
  document: DocumentRecord;
  vectorCount: number;
}

export interface RetrievedChunk {
  vectorId: string;
  chunkId: string;
  documentId: string;
  documentName: string;
  collectionId: string;
  collectionName: string;
  pageNumber: number;
  chunkIndex: number;
  excerpt: string;
  similarityScore: number;
}

export interface AssistantSource {
  title: string;
  documentId: string;
  page: number;
  excerpt: string;
  similarityScore?: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantQueryRequest {
  collectionId: string | null;
  query: string;
  mode?: AnyKnowledgeSourceMode;
  academicTrack?: AcademicTrack;
  history?: ConversationMessage[];
}

export interface RetrievalMetadata {
  retrievedChunks: number;
  collectionId: string | null;
  collectionName: string | null;
  topK: number;
  minSimilarity: number;
}

export interface AssistantQueryResponse {
  answer: string;
  knowledgeType: KnowledgeType;
  institutionalSection?: string | null;
  educationalSection?: string | null;
  sources: AssistantSource[];
  retrievalMetadata: RetrievalMetadata;
}

export interface ModuleReadiness {
  name: string;
  layer: 'server' | 'pdf' | 'rag' | 'storage' | 'llm';
  status: 'ready' | 'scaffolded' | 'not_configured';
  description: string;
}

export interface SystemHealthResponse {
  service: string;
  status: 'ok';
  timestamp: string;
  llmConfigured: boolean;
  storageProvider: string;
  ragPipelineActive: boolean;
  modules: ModuleReadiness[];
}

export type AssistantStreamEvent =
  | {
      type: 'status';
      phase: 'routing' | 'retrieving' | 'generating';
      message: string;
    }
  | {
      type: 'meta';
      knowledgeType: KnowledgeType;
      retrievalMetadata: RetrievalMetadata;
    }
  | {
      type: 'chunk';
      section: 'main' | 'institutional' | 'educational';
      text: string;
    }
  | {
      type: 'done';
      response: AssistantQueryResponse;
    }
  | {
      type: 'error';
      statusCode: number;
      error: string;
    };
