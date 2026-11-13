import { GoogleGenAI } from '@google/genai';
import { getServerConfig } from '../../config/env.ts';

let cachedClient: GoogleGenAI | null = null;

export const GEMINI_MODELS = {
  reasoningText: 'gemini-4-hydrogen',
  reasoningFallback: 'gemini-3.1-flash-lite',
  routerFast: 'gemini-3.1-flash-lite',
  stemAdvanced: 'gemini-4-argon',
  embedding: 'gemini-embedding-001',
} as const;

export const EMBEDDING_DIMENSIONS = 768;

export function isGeminiConfigured(): boolean {
  const { geminiApiKey } = getServerConfig();
  return Boolean(geminiApiKey && geminiApiKey.trim().length > 0);
}

export function getGeminiClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }

  const { geminiApiKey } = getServerConfig();
  if (!geminiApiKey || geminiApiKey.trim().length === 0) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  cachedClient = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return cachedClient;
}
