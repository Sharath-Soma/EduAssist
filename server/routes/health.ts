import { Router } from 'express';
import type { ModuleReadiness, SystemHealthResponse } from '../../shared/types/knowledge.ts';
import { isGeminiConfigured } from '../services/llm/geminiClient.ts';
import { ragPipeline } from '../services/rag/ragPipeline.ts';
import { getActiveStorageMode } from '../storage/storeFactory.ts';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const storageMode = getActiveStorageMode();
  const llmConfigured = isGeminiConfigured();
  const storageReady = storageMode === 'local-fs';

  const modules: ModuleReadiness[] = [
    {
      name: 'Express API & Static Host',
      layer: 'server',
      status: 'ready',
      description: 'Server-side API gateway and React SPA runtime.',
    },
    {
      name: 'Gemini LLM & Embeddings Client',
      layer: 'llm',
      status: llmConfigured ? 'ready' : 'not_configured',
      description: 'Server-exclusive @google/genai client (gemini-4-hydrogen & gemini-embedding-001).',
    },
    {
      name: 'Persistent Storage & Vector Index',
      layer: 'storage',
      status: storageReady ? 'ready' : 'scaffolded',
      description: `Separated PDF, metadata, and cosine vector index (${storageMode}).`,
    },
    {
      name: 'PDF Page Extractor',
      layer: 'pdf',
      status: 'ready',
      description: 'Page-indexed PDF text extraction via pdfjs-dist.',
    },
    {
      name: 'RAG Chunking, Ingestion & Retrieval',
      layer: 'rag',
      status: ragPipeline.isActive ? 'ready' : 'scaffolded',
      description:
        'Collection-isolated vector retrieval, intent routing, and grounded answer generation.',
    },
  ];

  const payload: SystemHealthResponse = {
    service: 'EduAssist',
    status: 'ok',
    timestamp: new Date().toISOString(),
    llmConfigured,
    storageProvider: storageMode,
    ragPipelineActive: ragPipeline.isActive,
    modules,
  };

  res.json(payload);
});
