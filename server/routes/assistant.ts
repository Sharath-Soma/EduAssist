import { Router, type Request, type Response } from 'express';
import type {
  AcademicTrack,
  AnyKnowledgeSourceMode,
  AssistantQueryRequest,
  AssistantStreamEvent,
  ConversationMessage,
} from '../../shared/types/knowledge.ts';
import { ragPipeline, RagValidationError } from '../services/rag/ragPipeline.ts';
import { CollectionNotFoundError } from '../services/rag/retriever.ts';

const VALID_TRACKS = new Set<AcademicTrack>([
  'classes_6_8',
  'classes_9_10',
  'classes_11_12',
  'degree',
  'btech_engineering',
]);

function sanitizeHistory(rawHistory: unknown): ConversationMessage[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  const sanitized: ConversationMessage[] = [];
  for (const item of rawHistory) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as { role?: unknown; content?: unknown };
    if (
      (candidate.role === 'user' || candidate.role === 'assistant') &&
      typeof candidate.content === 'string' &&
      candidate.content.trim().length > 0
    ) {
      sanitized.push({
        role: candidate.role,
        content: candidate.content.trim().slice(0, 1200),
      });
    }
  }
  return sanitized.slice(-6);
}

function parseAssistantBody(req: Request): AssistantQueryRequest {
  const body = req.body as Partial<AssistantQueryRequest>;
  const query = typeof body.query === 'string' ? body.query.trim() : '';

  if (query.length === 0) {
    throw new RagValidationError('Query text is required.', 400);
  }
  if (query.length > 4000) {
    throw new RagValidationError('Query text must be 4000 characters or fewer.', 400);
  }
  if (
    body.collectionId !== undefined &&
    body.collectionId !== null &&
    typeof body.collectionId !== 'string'
  ) {
    throw new RagValidationError('Invalid collectionId format.', 400);
  }

  const collectionId =
    typeof body.collectionId === 'string' && body.collectionId.trim().length > 0
      ? body.collectionId.trim()
      : null;

  const academicTrack: AcademicTrack =
    body.academicTrack && VALID_TRACKS.has(body.academicTrack)
      ? body.academicTrack
      : 'classes_11_12';

  return {
    query,
    collectionId,
    academicTrack,
    mode: body.mode as AnyKnowledgeSourceMode | undefined,
    history: sanitizeHistory(body.history),
  };
}

function classifyAssistantError(error: unknown): { statusCode: number; error: string } {
  if (error instanceof RagValidationError || error instanceof CollectionNotFoundError) {
    return { statusCode: error.statusCode, error: error.message };
  }
  if (error instanceof Error) {
    console.error('[Assistant Route Error]:', error.message);
    const msg = error.message.toLowerCase();
    if (
      msg.includes('quota') ||
      msg.includes('429') ||
      msg.includes('resource_exhausted') ||
      msg.includes('rate limit')
    ) {
      return {
        statusCode: 429,
        error:
          'Daily or per-minute Gemini free-tier quota has been reached for available models. Please wait a moment and retry, or check your Gemini API plan limits.',
      };
    }
    if (
      error.message.includes('GEMINI_API_KEY') ||
      msg.includes('503') ||
      msg.includes('unavailable')
    ) {
      return {
        statusCode: 503,
        error: 'The AI service is temporarily unavailable. Please wait a moment and click Retry.',
      };
    }
    if (
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      error.name === 'TimeoutError'
    ) {
      return {
        statusCode: 504,
        error: 'The AI request timed out. Please wait a moment and try again.',
      };
    }
    return { statusCode: 500, error: error.message };
  }
  return { statusCode: 500, error: 'Internal server error.' };
}

export const assistantRouter = Router();

assistantRouter.post('/assistant/query', async (req: Request, res: Response, next) => {
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const parsed = parseAssistantBody(req);
    const result = await ragPipeline.answerQuery(parsed, abortController.signal);
    if (!res.writableEnded) {
      res.status(200).json(result);
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    if (
      error instanceof RagValidationError ||
      error instanceof CollectionNotFoundError
    ) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const mapped = classifyAssistantError(error);
    if (mapped.statusCode === 429 || mapped.statusCode === 503) {
      res.status(mapped.statusCode).json({ error: mapped.error });
      return;
    }
    next(error);
  }
});

assistantRouter.post('/assistant/query/stream', async (req: Request, res: Response) => {
  let parsed: AssistantQueryRequest;
  try {
    parsed = parseAssistantBody(req);
  } catch (error) {
    const mapped = classifyAssistantError(error);
    res.status(mapped.statusCode).json({ error: mapped.error });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const abortController = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort();
    }
  });

  const emit = (event: AssistantStreamEvent) => {
    if (clientClosed || res.writableEnded) {
      return;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await ragPipeline.answerQueryStream(parsed, emit, abortController.signal);
  } catch (error) {
    if (clientClosed || abortController.signal.aborted) {
      return;
    }
    const mapped = classifyAssistantError(error);
    emit({
      type: 'error',
      statusCode: mapped.statusCode,
      error: mapped.error,
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});
