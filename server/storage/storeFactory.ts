import { getServerConfig } from '../config/env.ts';
import type { DocumentStorageAdapter, VectorStorageAdapter } from './interfaces.ts';
import { LocalFileSystemStore } from './localFileSystemStore.ts';
import { LocalFileSystemVectorStore } from './localFileSystemVectorStore.ts';
import { MemoryScaffoldStore } from './memoryScaffoldStore.ts';

let cachedDocumentStore: DocumentStorageAdapter | null = null;
let cachedVectorStore: VectorStorageAdapter | null = null;
let cachedMemoryStore: MemoryScaffoldStore | null = null;
let cachedKey: string | null = null;

export function getActiveStorageMode(): 'local-fs' | 'memory-only' {
  const { storageProvider } = getServerConfig();
  return storageProvider === 'memory-only' ? 'memory-only' : 'local-fs';
}

function ensureStores(): void {
  const config = getServerConfig();
  const mode = getActiveStorageMode();
  const key = `${mode}:${config.storageDir}`;

  if (cachedDocumentStore && cachedVectorStore && cachedKey === key) {
    return;
  }

  if (mode === 'memory-only') {
    cachedMemoryStore = new MemoryScaffoldStore();
    cachedDocumentStore = cachedMemoryStore;
    cachedVectorStore = cachedMemoryStore;
  } else {
    cachedDocumentStore = new LocalFileSystemStore(config.storageDir);
    cachedVectorStore = new LocalFileSystemVectorStore(config.storageDir);
  }

  cachedKey = key;
}

export function getDocumentStore(): DocumentStorageAdapter {
  ensureStores();
  return cachedDocumentStore!;
}

export function getVectorStore(): VectorStorageAdapter {
  ensureStores();
  return cachedVectorStore!;
}
