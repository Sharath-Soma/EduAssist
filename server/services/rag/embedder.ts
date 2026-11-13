import { EMBEDDING_DIMENSIONS, GEMINI_MODELS, getGeminiClient } from '../llm/geminiClient.ts';

export interface QueryEmbeddingResult {
  vector: number[];
  cacheHit: boolean;
  durationMs: number;
}

export interface TextEmbedder {
  readonly model: string;
  readonly dimensions: number;
  embedDocumentBatch(texts: string[], title?: string): Promise<number[][]>;
  embedDocumentTexts(
    texts: string[],
    options?: {
      batchSize?: number;
      title?: string;
      onBatchEmbedded?: (completedCount: number) => Promise<void> | void;
    },
  ): Promise<number[][]>;
  embedQuery(query: string, signal?: AbortSignal): Promise<number[]>;
  embedQueryWithStats?(query: string, signal?: AbortSignal): Promise<QueryEmbeddingResult>;
}

const DEFAULT_BATCH_SIZE = 20;
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const QUERY_EMBED_TIMEOUT_MS = 12_000;
const MAX_QUERY_RETRY_ATTEMPTS = 2;
const BASE_QUERY_RETRY_DELAY_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted')))
  );
}

function isRetryableError(error: unknown): boolean {
  if (isAbortError(error) || !(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const status = (error as { status?: number }).status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('timeout') ||
    message.includes('econnreset')
  );
}

const MAX_QUERY_EMBEDDING_CACHE = 100;

export class GeminiTextEmbedder implements TextEmbedder {
  readonly model = GEMINI_MODELS.embedding;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly queryCache = new Map<string, number[]>();
  private readonly inFlightQueries = new Map<string, Promise<number[]>>();

  private async withRetry<T>(
    operation: () => Promise<T>,
    options?: { maxAttempts?: number; baseDelayMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? MAX_RETRY_ATTEMPTS;
    const baseDelayMs = options?.baseDelayMs ?? BASE_RETRY_DELAY_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options?.signal?.aborted) {
        throw new Error('Request aborted.');
      }
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (
          options?.signal?.aborted ||
          !isRetryableError(error) ||
          attempt === maxAttempts
        ) {
          break;
        }
        const jitter = Math.floor(Math.random() * 150);
        const delayMs = baseDelayMs * 2 ** (attempt - 1) + jitter;
        await sleep(delayMs);
      }
    }

    const reason =
      lastError instanceof Error ? lastError.message : 'Unknown Gemini embedding error';
    throw new Error(`Gemini embedding request failed: ${reason}`);
  }

  async embedDocumentBatch(texts: string[], title?: string): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const ai = getGeminiClient();

    const response = await this.withRetry(() =>
      ai.models.embedContent({
        model: this.model,
        contents: texts,
        config: {
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: this.dimensions,
          ...(title ? { title } : {}),
        },
      }),
    );

    const embeddings = response.embeddings;
    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error(
        `Gemini embedding response count mismatch: expected ${texts.length}, received ${embeddings?.length ?? 0}.`,
      );
    }

    return embeddings.map((item, idx) => {
      const values = item.values;
      if (!Array.isArray(values) || values.length !== this.dimensions) {
        throw new Error(
          `Invalid embedding vector at batch index ${idx}: expected ${this.dimensions} dimensions, got ${values?.length ?? 0}.`,
        );
      }
      return values;
    });
  }

  async embedDocumentTexts(
    texts: string[],
    options?: {
      batchSize?: number;
      title?: string;
      onBatchEmbedded?: (completedCount: number) => Promise<void> | void;
    },
  ): Promise<number[][]> {
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const allVectors: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize);
      const vectors = await this.embedDocumentBatch(batch, options?.title);
      allVectors.push(...vectors);
      if (options?.onBatchEmbedded) {
        await options.onBatchEmbedded(allVectors.length);
      }
    }

    return allVectors;
  }

  async embedQueryWithStats(
    query: string,
    signal?: AbortSignal,
  ): Promise<QueryEmbeddingResult> {
    const startedAt = performance.now();
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('Cannot generate embedding for an empty query.');
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      this.queryCache.delete(cacheKey);
      this.queryCache.set(cacheKey, cached);
      return {
        vector: cached,
        cacheHit: true,
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    const existingPromise = this.inFlightQueries.get(cacheKey);
    if (existingPromise) {
      const vector = await existingPromise;
      return {
        vector,
        cacheHit: true,
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    const ai = getGeminiClient();
    const fetchPromise = this.withRetry(
      () => {
        const timeoutSignal = AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS);
        const combinedSignal = signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal;

        return ai.models.embedContent({
          model: this.model,
          contents: [trimmed],
          config: {
            taskType: 'RETRIEVAL_QUERY',
            outputDimensionality: this.dimensions,
            abortSignal: combinedSignal,
          },
        });
      },
      {
        maxAttempts: MAX_QUERY_RETRY_ATTEMPTS,
        baseDelayMs: BASE_QUERY_RETRY_DELAY_MS,
        signal,
      },
    )
      .then((response) => {
        const vector = response.embeddings?.[0]?.values;
        if (!Array.isArray(vector) || vector.length !== this.dimensions) {
          throw new Error('Gemini query embedding returned invalid dimensions.');
        }

        if (this.queryCache.size >= MAX_QUERY_EMBEDDING_CACHE) {
          const oldestKey = this.queryCache.keys().next().value;
          if (oldestKey !== undefined) {
            this.queryCache.delete(oldestKey);
          }
        }
        this.queryCache.set(cacheKey, vector);
        return vector;
      })
      .finally(() => {
        this.inFlightQueries.delete(cacheKey);
      });

    this.inFlightQueries.set(cacheKey, fetchPromise);
    const vector = await fetchPromise;

    return {
      vector,
      cacheHit: false,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  async embedQuery(query: string, signal?: AbortSignal): Promise<number[]> {
    const result = await this.embedQueryWithStats(query, signal);
    return result.vector;
  }
}

export const textEmbedder: TextEmbedder = new GeminiTextEmbedder();
