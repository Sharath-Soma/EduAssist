import type {
  AcademicTrack,
  AnyKnowledgeSourceMode,
  AssistantQueryRequest,
  AssistantQueryResponse,
  AssistantSource,
  AssistantStreamEvent,
  ConversationMessage,
  InstitutionCollection,
  KnowledgeSourceMode,
  RetrievedChunk,
} from '../../../shared/types/knowledge.ts';
import { getDocumentStore } from '../../storage/storeFactory.ts';
import {
  classifyQueryIntent,
  generateEducationalAnswer,
  generateInstitutionalAnswer,
  type IntentClassification,
  streamEducationalAnswer,
  streamInstitutionalAnswer,
  tryFastDeterministicRoute,
} from './answerGenerator.ts';
import {
  CollectionNotFoundError,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_RETRIEVAL_TOP_K,
  type RetrievalResult,
  vectorRetriever,
} from './retriever.ts';

export class RagValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RagValidationError';
    this.statusCode = statusCode;
  }
}

export function normalizeKnowledgeMode(
  mode: AnyKnowledgeSourceMode | undefined,
): KnowledgeSourceMode {
  switch (mode) {
    case undefined:
    case 'dual':
    case 'dual_separated':
      return 'dual';
    case 'institutional':
    case 'institutional_only':
      return 'institutional';
    case 'educational':
    case 'general_educational':
      return 'educational';
    default:
      throw new RagValidationError(
        'Invalid mode. Expected "dual", "institutional", or "educational".',
        400,
      );
  }
}

function mapChunksToSources(
  chunks: RetrievedChunk[],
  usedChunkIds: string[],
): AssistantSource[] {
  const chosen =
    usedChunkIds.length > 0
      ? chunks.filter((chunk) => usedChunkIds.includes(chunk.chunkId))
      : chunks;

  const deduped: AssistantSource[] = [];
  const seenKeys = new Set<string>();

  for (const chunk of chosen) {
    const key = `${chunk.documentId}:${chunk.pageNumber}:${chunk.chunkId}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    deduped.push({
      title: chunk.documentName,
      documentId: chunk.documentId,
      page: chunk.pageNumber,
      excerpt: chunk.excerpt,
      similarityScore: Number(chunk.similarityScore.toFixed(4)),
    });
  }

  return deduped;
}

interface RagTimingMetrics {
  mode: KnowledgeSourceMode;
  route: string;
  streaming: boolean;
  totalMs: number;
  routeMs: number;
  embedMs: number;
  retrievalMs: number;
  llmMs: number;
  chunks: number;
  embedCacheHit: boolean;
}

function logRagTiming(metrics: RagTimingMetrics): void {
  console.log(
    `[RAG Timing] mode=${metrics.mode} route=${metrics.route} stream=${metrics.streaming} totalMs=${metrics.totalMs} routeMs=${metrics.routeMs} embedMs=${metrics.embedMs} retrievalMs=${metrics.retrievalMs} llmMs=${metrics.llmMs} chunks=${metrics.chunks} embedCacheHit=${metrics.embedCacheHit}`,
  );
}

export interface RagPipeline {
  readonly isActive: boolean;
  answerQuery(
    request: AssistantQueryRequest,
    signal?: AbortSignal,
  ): Promise<AssistantQueryResponse>;
  answerQueryStream(
    request: AssistantQueryRequest,
    emit: (event: AssistantStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<AssistantQueryResponse>;
}

export class ActiveRagPipeline implements RagPipeline {
  readonly isActive = true;

  private async resolveContext(request: AssistantQueryRequest): Promise<{
    query: string;
    mode: KnowledgeSourceMode;
    academicTrack: AcademicTrack;
    history: ConversationMessage[];
    collection: InstitutionCollection | null;
    indexedDocIds: Set<string>;
  }> {
    const query = request.query.trim();
    if (!query) {
      throw new RagValidationError('Query text is required.', 400);
    }

    const mode = normalizeKnowledgeMode(request.mode);
    const academicTrack: AcademicTrack = request.academicTrack ?? 'classes_11_12';
    const history: ConversationMessage[] = Array.isArray(request.history)
      ? request.history
      : [];

    const documentStore = getDocumentStore();
    let collection: InstitutionCollection | null = null;
    let indexedDocIds = new Set<string>();

    if (request.collectionId) {
      collection = await documentStore.getCollectionById(request.collectionId);
      if (!collection) {
        throw new CollectionNotFoundError('Selected institution collection was not found.');
      }
      if (mode !== 'educational') {
        const docs = await documentStore.listDocumentsByCollection(collection.id);
        indexedDocIds = new Set(
          docs.filter((doc) => doc.status === 'indexed').map((doc) => doc.id),
        );
      }
    }

    if (mode === 'institutional' && !collection) {
      throw new RagValidationError(
        'An institutional collectionId is required when querying in institutional mode.',
        400,
      );
    }

    return { query, mode, academicTrack, history, collection, indexedDocIds };
  }

  private async resolveIntent(params: {
    query: string;
    collectionName: string | null;
    hasIndexedDocuments: boolean;
    history: ConversationMessage[];
    signal?: AbortSignal;
    onRoutingStart?: () => void;
  }): Promise<{ intent: IntentClassification; routeMs: number }> {
    const routeStart = performance.now();
    const fastRoute = tryFastDeterministicRoute(params.query, params.history);
    if (fastRoute) {
      return {
        intent: fastRoute,
        routeMs: Math.round(performance.now() - routeStart),
      };
    }

    params.onRoutingStart?.();
    const intent = await classifyQueryIntent({
      query: params.query,
      collectionName: params.collectionName,
      hasIndexedDocuments: params.hasIndexedDocuments,
      history: params.history,
      signal: params.signal,
    });

    return {
      intent,
      routeMs: Math.round(performance.now() - routeStart),
    };
  }

  private async retrieveChunks(params: {
    query: string;
    collection: InstitutionCollection | null;
    indexedDocIds: Set<string>;
    signal?: AbortSignal;
  }): Promise<{
    retrieval: RetrievalResult | undefined;
    embedMs: number;
    retrievalMs: number;
    embedCacheHit: boolean;
  }> {
    if (!params.collection || params.indexedDocIds.size === 0) {
      return {
        retrieval: undefined,
        embedMs: 0,
        retrievalMs: 0,
        embedCacheHit: false,
      };
    }

    const retrievalStart = performance.now();
    const retrieval = await vectorRetriever.retrieve({
      collectionId: params.collection.id,
      query: params.query,
      topK: DEFAULT_RETRIEVAL_TOP_K,
      minScore: DEFAULT_MIN_SIMILARITY,
      preloadedCollection: params.collection,
      preloadedIndexedDocIds: params.indexedDocIds,
      signal: params.signal,
    });

    return {
      retrieval,
      embedMs: retrieval.embedMs,
      retrievalMs: Math.round(performance.now() - retrievalStart),
      embedCacheHit: retrieval.embedCacheHit,
    };
  }

  private async runInstitutionalFlow(params: {
    query: string;
    collection: InstitutionCollection | null;
    indexedDocIds: Set<string>;
    history: ConversationMessage[];
    preloadedRetrieval?: RetrievalResult;
    streamTo?: (delta: string) => void;
    signal?: AbortSignal;
  }): Promise<{
    hasEvidence: boolean;
    answer: string;
    sources: AssistantSource[];
    retrievedChunks: number;
    topK: number;
    minSimilarity: number;
    embedMs: number;
    retrievalMs: number;
    llmMs: number;
    embedCacheHit: boolean;
  }> {
    if (!params.collection) {
      const msg =
        'No institutional collection is selected. Please select a school or college collection with indexed PDFs to verify official policies.';
      params.streamTo?.(msg);
      return {
        hasEvidence: false,
        answer: msg,
        sources: [],
        retrievedChunks: 0,
        topK: DEFAULT_RETRIEVAL_TOP_K,
        minSimilarity: DEFAULT_MIN_SIMILARITY,
        embedMs: 0,
        retrievalMs: 0,
        llmMs: 0,
        embedCacheHit: false,
      };
    }

    let retrieval = params.preloadedRetrieval;
    let embedMs = retrieval?.embedMs ?? 0;
    let retrievalMs = retrieval ? retrieval.embedMs + retrieval.vectorSearchMs : 0;
    let embedCacheHit = retrieval?.embedCacheHit ?? false;

    if (!retrieval) {
      const retrieved = await this.retrieveChunks({
        query: params.query,
        collection: params.collection,
        indexedDocIds: params.indexedDocIds,
        signal: params.signal,
      });
      retrieval = retrieved.retrieval;
      embedMs = retrieved.embedMs;
      retrievalMs = retrieved.retrievalMs;
      embedCacheHit = retrieved.embedCacheHit;
    }

    if (!retrieval || retrieval.indexedDocumentCount === 0) {
      const msg = `No indexed PDF documents are available in "${params.collection.name}" yet. Upload and process institutional PDFs before querying official policies.`;
      params.streamTo?.(msg);
      return {
        hasEvidence: false,
        answer: msg,
        sources: [],
        retrievedChunks: 0,
        topK: retrieval?.topK ?? DEFAULT_RETRIEVAL_TOP_K,
        minSimilarity: retrieval?.minScore ?? DEFAULT_MIN_SIMILARITY,
        embedMs,
        retrievalMs,
        llmMs: 0,
        embedCacheHit,
      };
    }

    if (retrieval.chunks.length === 0) {
      const msg = `The uploaded institutional documents in "${params.collection.name}" do not contain relevant information to answer this question.`;
      params.streamTo?.(msg);
      return {
        hasEvidence: false,
        answer: msg,
        sources: [],
        retrievedChunks: 0,
        topK: retrieval.topK,
        minSimilarity: retrieval.minScore,
        embedMs,
        retrievalMs,
        llmMs: 0,
        embedCacheHit,
      };
    }

    const llmStart = performance.now();
    const generated = params.streamTo
      ? await streamInstitutionalAnswer({
          query: params.query,
          collectionName: params.collection.name,
          chunks: retrieval.chunks,
          history: params.history,
          onTextChunk: params.streamTo,
          signal: params.signal,
        })
      : await generateInstitutionalAnswer({
          query: params.query,
          collectionName: params.collection.name,
          chunks: retrieval.chunks,
          history: params.history,
          signal: params.signal,
        });
    const llmMs = Math.round(performance.now() - llmStart);

    if (!generated.hasSufficientEvidence) {
      return {
        hasEvidence: false,
        answer: generated.answerMarkdown,
        sources: [],
        retrievedChunks: retrieval.chunks.length,
        topK: retrieval.topK,
        minSimilarity: retrieval.minScore,
        embedMs,
        retrievalMs,
        llmMs,
        embedCacheHit,
      };
    }

    const sources = mapChunksToSources(retrieval.chunks, generated.usedChunkIds);

    return {
      hasEvidence: true,
      answer: generated.answerMarkdown,
      sources,
      retrievedChunks: retrieval.chunks.length,
      topK: retrieval.topK,
      minSimilarity: retrieval.minScore,
      embedMs,
      retrievalMs,
      llmMs,
      embedCacheHit,
    };
  }

  async answerQuery(
    request: AssistantQueryRequest,
    signal?: AbortSignal,
  ): Promise<AssistantQueryResponse> {
    const requestStart = performance.now();
    const { query, mode, academicTrack, history, collection, indexedDocIds } =
      await this.resolveContext(request);

    if (mode === 'institutional') {
      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
        signal,
      });

      logRagTiming({
        mode,
        route: 'institutional',
        streaming: false,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs: 0,
        embedMs: inst.embedMs,
        retrievalMs: inst.retrievalMs,
        llmMs: inst.llmMs,
        chunks: inst.retrievedChunks,
        embedCacheHit: inst.embedCacheHit,
      });

      return {
        answer: inst.answer,
        knowledgeType: inst.hasEvidence ? 'institutional' : 'insufficient_evidence',
        institutionalSection: inst.answer,
        educationalSection: null,
        sources: inst.sources,
        retrievalMetadata: {
          retrievedChunks: inst.retrievedChunks,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: inst.topK,
          minSimilarity: inst.minSimilarity,
        },
      };
    }

    if (mode === 'educational') {
      const llmStart = performance.now();
      const educationalAnswer = await generateEducationalAnswer({
        query,
        academicTrack,
        history,
        signal,
      });
      const llmMs = Math.round(performance.now() - llmStart);

      logRagTiming({
        mode,
        route: 'educational',
        streaming: false,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs: 0,
        embedMs: 0,
        retrievalMs: 0,
        llmMs,
        chunks: 0,
        embedCacheHit: false,
      });

      return {
        answer: educationalAnswer,
        knowledgeType: 'educational',
        institutionalSection: null,
        educationalSection: educationalAnswer,
        sources: [],
        retrievalMetadata: {
          retrievedChunks: 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        },
      };
    }

    const { intent, routeMs } = await this.resolveIntent({
      query,
      collectionName: collection?.name ?? null,
      hasIndexedDocuments: indexedDocIds.size > 0,
      history,
      signal,
    });

    if (intent.route === 'ambiguous') {
      const clarification =
        intent.clarificationPrompt ||
        'Could you clarify whether you are asking about an official institutional rule from your uploaded documents, or an academic concept explanation?';

      logRagTiming({
        mode,
        route: 'ambiguous',
        streaming: false,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs,
        embedMs: 0,
        retrievalMs: 0,
        llmMs: 0,
        chunks: 0,
        embedCacheHit: false,
      });

      return {
        answer: clarification,
        knowledgeType: 'clarification',
        institutionalSection: null,
        educationalSection: null,
        sources: [],
        retrievalMetadata: {
          retrievedChunks: 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        },
      };
    }

    if (intent.route === 'institutional') {
      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
        signal,
      });

      logRagTiming({
        mode,
        route: 'institutional',
        streaming: false,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs,
        embedMs: inst.embedMs,
        retrievalMs: inst.retrievalMs,
        llmMs: inst.llmMs,
        chunks: inst.retrievedChunks,
        embedCacheHit: inst.embedCacheHit,
      });

      return {
        answer: inst.answer,
        knowledgeType: inst.hasEvidence ? 'institutional' : 'insufficient_evidence',
        institutionalSection: inst.answer,
        educationalSection: null,
        sources: inst.sources,
        retrievalMetadata: {
          retrievedChunks: inst.retrievedChunks,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: inst.topK,
          minSimilarity: inst.minSimilarity,
        },
      };
    }

    if (intent.route === 'educational') {
      const llmStart = performance.now();
      const educationalAnswer = await generateEducationalAnswer({
        query,
        academicTrack,
        history,
        signal,
      });
      const llmMs = Math.round(performance.now() - llmStart);

      logRagTiming({
        mode,
        route: 'educational',
        streaming: false,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs,
        embedMs: 0,
        retrievalMs: 0,
        llmMs,
        chunks: 0,
        embedCacheHit: false,
      });

      return {
        answer: educationalAnswer,
        knowledgeType: 'educational',
        institutionalSection: null,
        educationalSection: educationalAnswer,
        sources: [],
        retrievalMetadata: {
          retrievedChunks: 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        },
      };
    }

    const instQuery = intent.institutionalSubQuery || query;
    const eduQuery = intent.educationalSubQuery || query;

    const llmEduStart = performance.now();
    const [inst, educationalAnswer] = await Promise.all([
      this.runInstitutionalFlow({
        query: instQuery,
        collection,
        indexedDocIds,
        history,
        signal,
      }),
      generateEducationalAnswer({
        query: eduQuery,
        academicTrack,
        history,
        signal,
      }),
    ]);
    const parallelLlmMs = Math.max(
      inst.llmMs,
      Math.round(performance.now() - llmEduStart),
    );

    logRagTiming({
      mode,
      route: 'both',
      streaming: false,
      totalMs: Math.round(performance.now() - requestStart),
      routeMs,
      embedMs: inst.embedMs,
      retrievalMs: inst.retrievalMs,
      llmMs: parallelLlmMs,
      chunks: inst.retrievedChunks,
      embedCacheHit: inst.embedCacheHit,
    });

    const combinedMarkdown = [
      '### Institutional Knowledge',
      inst.answer,
      '',
      '### General Educational Knowledge',
      educationalAnswer,
    ].join('\n\n');

    return {
      answer: combinedMarkdown,
      knowledgeType: 'dual',
      institutionalSection: inst.answer,
      educationalSection: educationalAnswer,
      sources: inst.sources,
      retrievalMetadata: {
        retrievedChunks: inst.retrievedChunks,
        collectionId: collection?.id ?? null,
        collectionName: collection?.name ?? null,
        topK: inst.topK,
        minSimilarity: inst.minSimilarity,
      },
    };
  }

  async answerQueryStream(
    request: AssistantQueryRequest,
    emit: (event: AssistantStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<AssistantQueryResponse> {
    const requestStart = performance.now();
    const { query, mode, academicTrack, history, collection, indexedDocIds } =
      await this.resolveContext(request);

    if (mode === 'institutional') {
      let preloadedRetrieval: RetrievalResult | undefined;
      let embedMs = 0;
      let retrievalMs = 0;
      let embedCacheHit = false;

      if (collection && indexedDocIds.size > 0) {
        emit({
          type: 'status',
          phase: 'retrieving',
          message: 'Searching relevant documents',
        });

        const retrieved = await this.retrieveChunks({
          query,
          collection,
          indexedDocIds,
          signal,
        });
        preloadedRetrieval = retrieved.retrieval;
        embedMs = retrieved.embedMs;
        retrievalMs = retrieved.retrievalMs;
        embedCacheHit = retrieved.embedCacheHit;
      }

      emit({
        type: 'meta',
        knowledgeType: 'institutional',
        retrievalMetadata: {
          retrievedChunks: preloadedRetrieval?.chunks.length ?? 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: preloadedRetrieval?.topK ?? DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: preloadedRetrieval?.minScore ?? DEFAULT_MIN_SIMILARITY,
        },
      });

      emit({
        type: 'status',
        phase: 'generating',
        message: 'Preparing answer',
      });

      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
        preloadedRetrieval,
        streamTo: (text) => emit({ type: 'chunk', section: 'main', text }),
        signal,
      });

      logRagTiming({
        mode,
        route: 'institutional',
        streaming: true,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs: 0,
        embedMs: preloadedRetrieval ? embedMs : inst.embedMs,
        retrievalMs: preloadedRetrieval ? retrievalMs : inst.retrievalMs,
        llmMs: inst.llmMs,
        chunks: inst.retrievedChunks,
        embedCacheHit: preloadedRetrieval ? embedCacheHit : inst.embedCacheHit,
      });

      const finalResponse: AssistantQueryResponse = {
        answer: inst.answer,
        knowledgeType: inst.hasEvidence ? 'institutional' : 'insufficient_evidence',
        institutionalSection: inst.answer,
        educationalSection: null,
        sources: inst.sources,
        retrievalMetadata: {
          retrievedChunks: inst.retrievedChunks,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: inst.topK,
          minSimilarity: inst.minSimilarity,
        },
      };

      emit({ type: 'done', response: finalResponse });
      return finalResponse;
    }

    if (mode === 'educational') {
      emit({
        type: 'meta',
        knowledgeType: 'educational',
        retrievalMetadata: {
          retrievedChunks: 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        },
      });

      emit({
        type: 'status',
        phase: 'generating',
        message: 'Preparing answer',
      });

      const llmStart = performance.now();
      const educationalAnswer = await streamEducationalAnswer({
        query,
        academicTrack,
        history,
        onTextChunk: (text) => emit({ type: 'chunk', section: 'main', text }),
        signal,
      });
      const llmMs = Math.round(performance.now() - llmStart);

      logRagTiming({
        mode,
        route: 'educational',
        streaming: true,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs: 0,
        embedMs: 0,
        retrievalMs: 0,
        llmMs,
        chunks: 0,
        embedCacheHit: false,
      });

      const finalResponse: AssistantQueryResponse = {
        answer: educationalAnswer,
        knowledgeType: 'educational',
        institutionalSection: null,
        educationalSection: educationalAnswer,
        sources: [],
        retrievalMetadata: {
          retrievedChunks: 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        },
      };

      emit({ type: 'done', response: finalResponse });
      return finalResponse;
    }

    const { intent, routeMs } = await this.resolveIntent({
      query,
      collectionName: collection?.name ?? null,
      hasIndexedDocuments: indexedDocIds.size > 0,
      history,
      signal,
      onRoutingStart: () => {
        emit({
          type: 'status',
          phase: 'routing',
          message: 'Understanding question',
        });
      },
    });

    if (intent.route === 'ambiguous') {
      const clarification =
        intent.clarificationPrompt ||
        'Could you clarify whether you are asking about an official institutional rule from your uploaded documents, or an academic concept explanation?';

      const finalResponse: AssistantQueryResponse = {
        answer: clarification,
        knowledgeType: 'clarification',
        institutionalSection: null,
        educationalSection: null,
        sources: [],
        retrievalMetadata: {
          retrievedChunks: 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        },
      };

      logRagTiming({
        mode,
        route: 'ambiguous',
        streaming: true,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs,
        embedMs: 0,
        retrievalMs: 0,
        llmMs: 0,
        chunks: 0,
        embedCacheHit: false,
      });

      emit({
        type: 'meta',
        knowledgeType: 'clarification',
        retrievalMetadata: finalResponse.retrievalMetadata,
      });
      emit({ type: 'chunk', section: 'main', text: clarification });
      emit({ type: 'done', response: finalResponse });
      return finalResponse;
    }

    if (intent.route === 'educational') {
      const retrievalMeta = {
        retrievedChunks: 0,
        collectionId: collection?.id ?? null,
        collectionName: collection?.name ?? null,
        topK: DEFAULT_RETRIEVAL_TOP_K,
        minSimilarity: DEFAULT_MIN_SIMILARITY,
      };
      emit({ type: 'meta', knowledgeType: 'educational', retrievalMetadata: retrievalMeta });
      emit({
        type: 'status',
        phase: 'generating',
        message: 'Preparing answer',
      });

      const llmStart = performance.now();
      const educationalAnswer = await streamEducationalAnswer({
        query,
        academicTrack,
        history,
        onTextChunk: (text) => emit({ type: 'chunk', section: 'main', text }),
        signal,
      });
      const llmMs = Math.round(performance.now() - llmStart);

      logRagTiming({
        mode,
        route: 'educational',
        streaming: true,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs,
        embedMs: 0,
        retrievalMs: 0,
        llmMs,
        chunks: 0,
        embedCacheHit: false,
      });

      const finalResponse: AssistantQueryResponse = {
        answer: educationalAnswer,
        knowledgeType: 'educational',
        institutionalSection: null,
        educationalSection: educationalAnswer,
        sources: [],
        retrievalMetadata: retrievalMeta,
      };

      emit({ type: 'done', response: finalResponse });
      return finalResponse;
    }

    if (intent.route === 'institutional') {
      let preloadedRetrieval: RetrievalResult | undefined;
      let embedMs = 0;
      let retrievalMs = 0;
      let embedCacheHit = false;

      if (collection && indexedDocIds.size > 0) {
        emit({
          type: 'status',
          phase: 'retrieving',
          message: 'Searching relevant documents',
        });

        const retrieved = await this.retrieveChunks({
          query,
          collection,
          indexedDocIds,
          signal,
        });
        preloadedRetrieval = retrieved.retrieval;
        embedMs = retrieved.embedMs;
        retrievalMs = retrieved.retrievalMs;
        embedCacheHit = retrieved.embedCacheHit;
      }

      emit({
        type: 'meta',
        knowledgeType: 'institutional',
        retrievalMetadata: {
          retrievedChunks: preloadedRetrieval?.chunks.length ?? 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: preloadedRetrieval?.topK ?? DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: preloadedRetrieval?.minScore ?? DEFAULT_MIN_SIMILARITY,
        },
      });
      emit({
        type: 'status',
        phase: 'generating',
        message: 'Preparing answer',
      });

      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
        preloadedRetrieval,
        streamTo: (text) => emit({ type: 'chunk', section: 'main', text }),
        signal,
      });

      logRagTiming({
        mode,
        route: 'institutional',
        streaming: true,
        totalMs: Math.round(performance.now() - requestStart),
        routeMs,
        embedMs: preloadedRetrieval ? embedMs : inst.embedMs,
        retrievalMs: preloadedRetrieval ? retrievalMs : inst.retrievalMs,
        llmMs: inst.llmMs,
        chunks: inst.retrievedChunks,
        embedCacheHit: preloadedRetrieval ? embedCacheHit : inst.embedCacheHit,
      });

      const finalResponse: AssistantQueryResponse = {
        answer: inst.answer,
        knowledgeType: inst.hasEvidence ? 'institutional' : 'insufficient_evidence',
        institutionalSection: inst.answer,
        educationalSection: null,
        sources: inst.sources,
        retrievalMetadata: {
          retrievedChunks: inst.retrievedChunks,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: inst.topK,
          minSimilarity: inst.minSimilarity,
        },
      };

      emit({ type: 'done', response: finalResponse });
      return finalResponse;
    }

    const instQuery = intent.institutionalSubQuery || query;
    const eduQuery = intent.educationalSubQuery || query;

    let preloadedInst: RetrievalResult | undefined;
    let embedMs = 0;
    let retrievalMs = 0;
    let embedCacheHit = false;

    if (collection && indexedDocIds.size > 0) {
      emit({
        type: 'status',
        phase: 'retrieving',
        message: 'Searching relevant documents',
      });

      const retrieved = await this.retrieveChunks({
        query: instQuery,
        collection,
        indexedDocIds,
        signal,
      });
      preloadedInst = retrieved.retrieval;
      embedMs = retrieved.embedMs;
      retrievalMs = retrieved.retrievalMs;
      embedCacheHit = retrieved.embedCacheHit;
    }

    emit({
      type: 'meta',
      knowledgeType: 'dual',
      retrievalMetadata: {
        retrievedChunks: preloadedInst?.chunks.length ?? 0,
        collectionId: collection?.id ?? null,
        collectionName: collection?.name ?? null,
        topK: preloadedInst?.topK ?? DEFAULT_RETRIEVAL_TOP_K,
        minSimilarity: preloadedInst?.minScore ?? DEFAULT_MIN_SIMILARITY,
      },
    });
    emit({
      type: 'status',
      phase: 'generating',
      message: 'Preparing answer',
    });

    const parallelStart = performance.now();
    const [inst, educationalAnswer] = await Promise.all([
      this.runInstitutionalFlow({
        query: instQuery,
        collection,
        indexedDocIds,
        history,
        preloadedRetrieval: preloadedInst,
        streamTo: (text) => emit({ type: 'chunk', section: 'institutional', text }),
        signal,
      }),
      streamEducationalAnswer({
        query: eduQuery,
        academicTrack,
        history,
        onTextChunk: (text) => emit({ type: 'chunk', section: 'educational', text }),
        signal,
      }),
    ]);
    const parallelLlmMs = Math.max(
      inst.llmMs,
      Math.round(performance.now() - parallelStart),
    );

    logRagTiming({
      mode,
      route: 'both',
      streaming: true,
      totalMs: Math.round(performance.now() - requestStart),
      routeMs,
      embedMs: preloadedInst ? embedMs : inst.embedMs,
      retrievalMs: preloadedInst ? retrievalMs : inst.retrievalMs,
      llmMs: parallelLlmMs,
      chunks: inst.retrievedChunks,
      embedCacheHit: preloadedInst ? embedCacheHit : inst.embedCacheHit,
    });

    const combinedMarkdown = [
      '### Institutional Knowledge',
      inst.answer,
      '',
      '### General Educational Knowledge',
      educationalAnswer,
    ].join('\n\n');

    const finalResponse: AssistantQueryResponse = {
      answer: combinedMarkdown,
      knowledgeType: 'dual',
      institutionalSection: inst.answer,
      educationalSection: educationalAnswer,
      sources: inst.sources,
      retrievalMetadata: {
        retrievedChunks: inst.retrievedChunks,
        collectionId: collection?.id ?? null,
        collectionName: collection?.name ?? null,
        topK: inst.topK,
        minSimilarity: inst.minSimilarity,
      },
    };

    emit({ type: 'done', response: finalResponse });
    return finalResponse;
  }
}

export const ragPipeline: RagPipeline = new ActiveRagPipeline();
