import { EMBEDDING_DIMENSIONS, GEMINI_MODELS, getGeminiClient } from '../llm/geminiClient.ts';

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
  embedQuery(query: string): Promise<number[]>;
}

const DEFAULT_BATCH_SIZE = 20;
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
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

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt === MAX_RETRY_ATTEMPTS) {
          break;
        }
        const jitter = Math.floor(Math.random() * 250);
        const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1) + jitter;
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

  async embedQuery(query: string): Promise<number[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('Cannot generate embedding for an empty query.');
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      this.queryCache.delete(cacheKey);
      this.queryCache.set(cacheKey, cached);
      return cached;
    }

    const ai = getGeminiClient();
    const response = await this.withRetry(() =>
      ai.models.embedContent({
        model: this.model,
        contents: [trimmed],
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: this.dimensions,
        },
      }),
    );

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
  }
}

export const textEmbedder: TextEmbedder = new GeminiTextEmbedder();
