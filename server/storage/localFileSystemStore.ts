import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CreateCollectionInput,
  DocumentRecord,
  InstitutionCollection,
} from '../../shared/types/knowledge.ts';
import type {
  DocumentStorageAdapter,
  DuplicateCheckParams,
  StoreDocumentFileParams,
} from './interfaces.ts';

interface MetadataSnapshot {
  collections: InstitutionCollection[];
  documents: DocumentRecord[];
}

/**
 * Persistent local filesystem storage adapter.
 * Stores uploaded PDF binaries separately from JSON metadata registries
 * so collections and uploaded documents survive refreshes and server restarts.
 */
export class LocalFileSystemStore implements DocumentStorageAdapter {
  private readonly baseDir: string;
  private readonly metadataDir: string;
  private readonly uploadsDir: string;
  private readonly collectionsPath: string;
  private readonly documentsPath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.metadataDir = path.join(baseDir, 'metadata');
    this.uploadsDir = path.join(baseDir, 'uploads');
    this.collectionsPath = path.join(this.metadataDir, 'collections.json');
    this.documentsPath = path.join(this.metadataDir, 'documents.json');
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.metadataDir, { recursive: true });
    await fs.mkdir(this.uploadsDir, { recursive: true });
  }

  private async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return fallback;
      }
      throw error;
    }
  }

  private async writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
    await this.ensureDirectories();
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  }

  private async readSnapshot(): Promise<MetadataSnapshot> {
    await this.ensureDirectories();
    const [collections, documents] = await Promise.all([
      this.readJsonFile<InstitutionCollection[]>(this.collectionsPath, []),
      this.readJsonFile<DocumentRecord[]>(this.documentsPath, []),
    ]);
    return { collections, documents };
  }

  private resolveStorageKey(storageKey: string): string {
    const resolved = path.resolve(this.baseDir, storageKey);
    const relative = path.relative(this.baseDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid storage key outside storage directory.');
    }
    return resolved;
  }

  async listCollections(): Promise<InstitutionCollection[]> {
    const { collections, documents } = await this.readSnapshot();
    const countsByCollection = new Map<string, number>();
    for (const doc of documents) {
      countsByCollection.set(
        doc.collectionId,
        (countsByCollection.get(doc.collectionId) ?? 0) + 1,
      );
    }

    return collections
      .map((collection) => ({
        ...collection,
        documentCount: countsByCollection.get(collection.id) ?? 0,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getCollectionById(collectionId: string): Promise<InstitutionCollection | null> {
    const collections = await this.listCollections();
    return collections.find((collection) => collection.id === collectionId) ?? null;
  }

  async createCollection(input: CreateCollectionInput): Promise<InstitutionCollection> {
    return this.enqueue(async () => {
      const { collections } = await this.readSnapshot();
      const created: InstitutionCollection = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        institutionType: input.institutionType,
        academicTrack: input.academicTrack,
        description: (input.description ?? '').trim(),
        documentCount: 0,
        createdAt: new Date().toISOString(),
      };

      collections.push(created);
      await this.writeJsonAtomic(this.collectionsPath, collections);
      return created;
    });
  }

  async listDocumentsByCollection(collectionId: string): Promise<DocumentRecord[]> {
    const { documents } = await this.readSnapshot();
    return documents
      .filter((doc) => doc.collectionId === collectionId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async getDocumentById(documentId: string): Promise<DocumentRecord | null> {
    const { documents } = await this.readSnapshot();
    return documents.find((doc) => doc.id === documentId) ?? null;
  }

  async findDuplicateDocument(
    collectionId: string,
    params: DuplicateCheckParams,
  ): Promise<DocumentRecord | null> {
    const { documents } = await this.readSnapshot();
    const normalizedName = params.filename.trim().toLowerCase();

    return (
      documents.find(
        (doc) =>
          doc.collectionId === collectionId &&
          (doc.sha256 === params.sha256 ||
            doc.filename.trim().toLowerCase() === normalizedName),
      ) ?? null
    );
  }

  async storeDocumentFile(params: StoreDocumentFileParams): Promise<string> {
    const collectionDir = path.join(this.uploadsDir, params.collectionId);
    await fs.mkdir(collectionDir, { recursive: true });

    const storageKey = path.posix.join(
      'uploads',
      params.collectionId,
      `${params.documentId}.pdf`,
    );
    const targetPath = this.resolveStorageKey(storageKey);
    await fs.writeFile(targetPath, params.buffer);
    return storageKey;
  }

  async readDocumentFile(storageKey: string): Promise<Buffer> {
    const filePath = this.resolveStorageKey(storageKey);
    return fs.readFile(filePath);
  }

  async saveDocumentMetadata(record: DocumentRecord): Promise<DocumentRecord> {
    return this.enqueue(async () => {
      const { collections, documents } = await this.readSnapshot();
      const nextDocuments = documents.filter((doc) => doc.id !== record.id);
      nextDocuments.push(record);

      const nextCollections = collections.map((collection) => {
        if (collection.id !== record.collectionId) {
          return collection;
        }
        const count = nextDocuments.filter(
          (doc) => doc.collectionId === record.collectionId,
        ).length;
        return { ...collection, documentCount: count };
      });

      await this.writeJsonAtomic(this.documentsPath, nextDocuments);
      await this.writeJsonAtomic(this.collectionsPath, nextCollections);
      return record;
    });
  }

  async deleteDocument(documentId: string): Promise<DocumentRecord | null> {
    return this.enqueue(async () => {
      const { collections, documents } = await this.readSnapshot();
      const target = documents.find((doc) => doc.id === documentId);
      if (!target) {
        return null;
      }

      const nextDocuments = documents.filter((doc) => doc.id !== documentId);
      const nextCollections = collections.map((collection) => {
        if (collection.id !== target.collectionId) {
          return collection;
        }
        const count = nextDocuments.filter(
          (doc) => doc.collectionId === target.collectionId,
        ).length;
        return { ...collection, documentCount: count };
      });

      await this.writeJsonAtomic(this.documentsPath, nextDocuments);
      await this.writeJsonAtomic(this.collectionsPath, nextCollections);

      try {
        const filePath = this.resolveStorageKey(target.storageKey);
        await fs.unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      return target;
    });
  }
}
