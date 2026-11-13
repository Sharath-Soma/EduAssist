import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  geminiApiKey: string | undefined;
  storageProvider: string;
  storageDir: string;
}

export function getServerConfig(): ServerConfig {
  const parsedPort = Number(process.env.PORT ?? '3000');

  return {
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    geminiApiKey: process.env.GEMINI_API_KEY,
    storageProvider: process.env.STORAGE_PROVIDER ?? 'local-fs',
    storageDir: process.env.STORAGE_DIR
      ? path.resolve(process.env.STORAGE_DIR)
      : path.resolve(process.cwd(), 'data'),
  };
}
