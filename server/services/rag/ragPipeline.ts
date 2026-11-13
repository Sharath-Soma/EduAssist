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
  streamEducationalAnswer,
  streamInstitutionalAnswer,
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

export interface RagPipeline {
  readonly isActive: boolean;
  answerQuery(request: AssistantQueryRequest): Promise<AssistantQueryResponse>;
  answerQueryStream(
    request: AssistantQueryRequest,
    emit: (event: AssistantStreamEvent) => void,
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
      const docs = await documentStore.listDocumentsByCollection(collection.id);
      indexedDocIds = new Set(
        docs.filter((doc) => doc.status === 'indexed').map((doc) => doc.id),
      );
    }

    if (mode === 'institutional' && !collection) {
      throw new RagValidationError(
        'An institutional collectionId is required when querying in institutional mode.',
        400,
      );
    }

    return { query, mode, academicTrack, history, collection, indexedDocIds };
  }

  private async runInstitutionalFlow(params: {
    query: string;
    collection: InstitutionCollection | null;
    indexedDocIds: Set<string>;
    history: ConversationMessage[];
    preloadedRetrieval?: RetrievalResult;
    streamTo?: (delta: string) => void;
  }): Promise<{
    hasEvidence: boolean;
    answer: string;
    sources: AssistantSource[];
    retrievedChunks: number;
    topK: number;
    minSimilarity: number;
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
      };
    }

    const retrieval =
      params.preloadedRetrieval ??
      (await vectorRetriever.retrieve({
        collectionId: params.collection.id,
        query: params.query,
        topK: DEFAULT_RETRIEVAL_TOP_K,
        minScore: DEFAULT_MIN_SIMILARITY,
        preloadedCollection: params.collection,
        preloadedIndexedDocIds: params.indexedDocIds,
      }));

    if (retrieval.indexedDocumentCount === 0) {
      const msg = `No indexed PDF documents are available in "${params.collection.name}" yet. Upload and process institutional PDFs before querying official policies.`;
      params.streamTo?.(msg);
      return {
        hasEvidence: false,
        answer: msg,
        sources: [],
        retrievedChunks: 0,
        topK: retrieval.topK,
        minSimilarity: retrieval.minScore,
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
      };
    }

    const generated = params.streamTo
      ? await streamInstitutionalAnswer({
          query: params.query,
          collectionName: params.collection.name,
          chunks: retrieval.chunks,
          history: params.history,
          onTextChunk: params.streamTo,
        })
      : await generateInstitutionalAnswer({
          query: params.query,
          collectionName: params.collection.name,
          chunks: retrieval.chunks,
          history: params.history,
        });

    if (!generated.hasSufficientEvidence) {
      return {
        hasEvidence: false,
        answer: generated.answerMarkdown,
        sources: [],
        retrievedChunks: retrieval.chunks.length,
        topK: retrieval.topK,
        minSimilarity: retrieval.minScore,
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
    };
  }

  async answerQuery(request: AssistantQueryRequest): Promise<AssistantQueryResponse> {
    const { query, mode, academicTrack, history, collection, indexedDocIds } =
      await this.resolveContext(request);

    if (mode === 'institutional') {
      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
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
      const educationalAnswer = await generateEducationalAnswer({
        query,
        academicTrack,
        history,
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

    const retrievalPromise =
      collection && indexedDocIds.size > 0
        ? vectorRetriever
            .retrieve({
              collectionId: collection.id,
              query,
              topK: DEFAULT_RETRIEVAL_TOP_K,
              minScore: DEFAULT_MIN_SIMILARITY,
              preloadedCollection: collection,
              preloadedIndexedDocIds: indexedDocIds,
            })
            .catch(() => undefined)
        : Promise.resolve(undefined);

    const [intent, speculativeRetrieval] = await Promise.all([
      classifyQueryIntent({
        query,
        collectionName: collection?.name ?? null,
        hasIndexedDocuments: indexedDocIds.size > 0,
        history,
      }),
      retrievalPromise,
    ]);

    if (intent.route === 'ambiguous') {
      const clarification =
        intent.clarificationPrompt ||
        'Could you clarify whether you are asking about an official institutional rule from your uploaded documents, or an academic concept explanation?';

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
        preloadedRetrieval: speculativeRetrieval,
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
      const educationalAnswer = await generateEducationalAnswer({
        query,
        academicTrack,
        history,
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

    const [inst, educationalAnswer] = await Promise.all([
      this.runInstitutionalFlow({
        query: instQuery,
        collection,
        indexedDocIds,
        history,
        preloadedRetrieval: instQuery === query ? speculativeRetrieval : undefined,
      }),
      generateEducationalAnswer({
        query: eduQuery,
        academicTrack,
        history,
      }),
    ]);

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
  ): Promise<AssistantQueryResponse> {
    const { query, mode, academicTrack, history, collection, indexedDocIds } =
      await this.resolveContext(request);

    if (mode === 'institutional') {
      emit({
        type: 'status',
        phase: 'retrieving',
        message: 'Searching institutional PDFs...',
      });

      const retrieval = collection
        ? await vectorRetriever.retrieve({
            collectionId: collection.id,
            query,
            topK: DEFAULT_RETRIEVAL_TOP_K,
            minScore: DEFAULT_MIN_SIMILARITY,
            preloadedCollection: collection,
            preloadedIndexedDocIds: indexedDocIds,
          })
        : undefined;

      emit({
        type: 'meta',
        knowledgeType: 'institutional',
        retrievalMetadata: {
          retrievedChunks: retrieval?.chunks.length ?? 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: retrieval?.topK ?? DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: retrieval?.minScore ?? DEFAULT_MIN_SIMILARITY,
        },
      });

      emit({
        type: 'status',
        phase: 'generating',
        message: 'Generating grounded institutional answer...',
      });

      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
        preloadedRetrieval: retrieval,
        streamTo: (text) => emit({ type: 'chunk', section: 'main', text }),
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
        message: 'Generating educational explanation...',
      });

      const educationalAnswer = await streamEducationalAnswer({
        query,
        academicTrack,
        history,
        onTextChunk: (text) => emit({ type: 'chunk', section: 'main', text }),
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

    emit({
      type: 'status',
      phase: 'routing',
      message:
        indexedDocIds.size > 0
          ? 'Routing query and searching institutional PDFs...'
          : 'Analyzing query...',
    });

    const retrievalPromise =
      collection && indexedDocIds.size > 0
        ? vectorRetriever
            .retrieve({
              collectionId: collection.id,
              query,
              topK: DEFAULT_RETRIEVAL_TOP_K,
              minScore: DEFAULT_MIN_SIMILARITY,
              preloadedCollection: collection,
              preloadedIndexedDocIds: indexedDocIds,
            })
            .catch(() => undefined)
        : Promise.resolve(undefined);

    const [intent, speculativeRetrieval] = await Promise.all([
      classifyQueryIntent({
        query,
        collectionName: collection?.name ?? null,
        hasIndexedDocuments: indexedDocIds.size > 0,
        history,
      }),
      retrievalPromise,
    ]);

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

      emit({
        type: 'meta',
        knowledgeType: 'clarification',
        retrievalMetadata: finalResponse.retrievalMetadata,
      });
      emit({ type: 'chunk', section: 'main', text: clarification });
      emit({ type: 'done', response: finalResponse });
      return finalResponse;
    }

    if (intent.route === 'institutional') {
      emit({
        type: 'meta',
        knowledgeType: 'institutional',
        retrievalMetadata: {
          retrievedChunks: speculativeRetrieval?.chunks.length ?? 0,
          collectionId: collection?.id ?? null,
          collectionName: collection?.name ?? null,
          topK: speculativeRetrieval?.topK ?? DEFAULT_RETRIEVAL_TOP_K,
          minSimilarity: speculativeRetrieval?.minScore ?? DEFAULT_MIN_SIMILARITY,
        },
      });
      emit({
        type: 'status',
        phase: 'generating',
        message: 'Generating grounded institutional answer...',
      });

      const inst = await this.runInstitutionalFlow({
        query,
        collection,
        indexedDocIds,
        history,
        preloadedRetrieval: speculativeRetrieval,
        streamTo: (text) => emit({ type: 'chunk', section: 'main', text }),
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
        message: 'Generating educational explanation...',
      });

      const educationalAnswer = await streamEducationalAnswer({
        query,
        academicTrack,
        history,
        onTextChunk: (text) => emit({ type: 'chunk', section: 'main', text }),
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

    const instQuery = intent.institutionalSubQuery || query;
    const eduQuery = intent.educationalSubQuery || query;
    const preloadedInst =
      instQuery === query
        ? speculativeRetrieval
        : collection && indexedDocIds.size > 0
          ? await vectorRetriever
              .retrieve({
                collectionId: collection.id,
                query: instQuery,
                topK: DEFAULT_RETRIEVAL_TOP_K,
                minScore: DEFAULT_MIN_SIMILARITY,
                preloadedCollection: collection,
                preloadedIndexedDocIds: indexedDocIds,
              })
              .catch(() => undefined)
          : undefined;

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
      message: 'Streaming institutional and educational sections...',
    });

    const inst = await this.runInstitutionalFlow({
      query: instQuery,
      collection,
      indexedDocIds,
      history,
      preloadedRetrieval: preloadedInst,
      streamTo: (text) => emit({ type: 'chunk', section: 'institutional', text }),
    });

    const educationalAnswer = await streamEducationalAnswer({
      query: eduQuery,
      academicTrack,
      history,
      onTextChunk: (text) => emit({ type: 'chunk', section: 'educational', text }),
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
