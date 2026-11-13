import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type {
  AcademicTrack,
  CreateCollectionInput,
  DocumentIngestionStatusResponse,
  DocumentRecord,
  InstitutionType,
} from '../../shared/types/knowledge.ts';
import { PdfExtractionError } from '../services/pdf/pdfProcessor.ts';
import {
  ingestCollectionDocument,
  IngestionConflictError,
  IngestionNotFoundError,
  isDocumentActivelyProcessing,
} from '../services/rag/ingestionService.ts';
import { getDocumentStore, getVectorStore } from '../storage/storeFactory.ts';

export const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const VALID_INSTITUTION_TYPES = new Set<InstitutionType>(['school', 'college']);
const VALID_TRACKS = new Set<AcademicTrack>([
  'classes_6_8',
  'classes_9_10',
  'classes_11_12',
  'degree',
  'btech_engineering',
]);

export class UploadValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'UploadValidationError';
    this.statusCode = statusCode;
  }
}

function sanitizeFilename(originalName: string): string {
  const baseName = path.basename(originalName).trim();
  return baseName.replace(/[\r\n\0]/g, '');
}

function hasPdfMagicHeader(buffer: Buffer): boolean {
  if (buffer.length < 5) {
    return false;
  }
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PDF_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isPdfMime =
      file.mimetype === 'application/pdf' || file.mimetype === 'application/x-pdf';

    if (ext !== '.pdf' || !isPdfMime) {
      callback(
        new UploadValidationError(
          'Only valid PDF files (.pdf with application/pdf MIME type) are accepted.',
          400,
        ),
      );
      return;
    }

    callback(null, true);
  },
});

export const collectionsRouter = Router();

collectionsRouter.get('/collections', async (_req, res, next) => {
  try {
    const store = getDocumentStore();
    const collections = await store.listCollections();
    res.json({ collections });
  } catch (error) {
    next(error);
  }
});

collectionsRouter.post('/collections', async (req, res, next) => {
  try {
    const store = getDocumentStore();
    const body = req.body as Partial<CreateCollectionInput>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (name.length < 2) {
      res.status(400).json({ error: 'Collection name must be at least 2 characters.' });
      return;
    }

    if (!body.institutionType || !VALID_INSTITUTION_TYPES.has(body.institutionType)) {
      res
        .status(400)
        .json({ error: 'Invalid institutionType. Expected "school" or "college".' });
      return;
    }

    if (!body.academicTrack || !VALID_TRACKS.has(body.academicTrack)) {
      res.status(400).json({ error: 'Invalid academicTrack.' });
      return;
    }

    const created = await store.createCollection({
      name,
      institutionType: body.institutionType,
      academicTrack: body.academicTrack,
      description: typeof body.description === 'string' ? body.description : '',
    });

    res.status(201).json({ collection: created });
  } catch (error) {
    next(error);
  }
});

collectionsRouter.get('/collections/:id/documents', async (req, res, next) => {
  try {
    const store = getDocumentStore();
    const collection = await store.getCollectionById(req.params.id);
    if (!collection) {
      res.status(404).json({ error: 'Collection not found.' });
      return;
    }

    const documents = await store.listDocumentsByCollection(collection.id);
    res.json({ collection, documents });
  } catch (error) {
    next(error);
  }
});

collectionsRouter.post(
  '/collections/:id/documents',
  pdfUpload.single('file'),
  async (req, res, next) => {
    try {
      const store = getDocumentStore();
      const collection = await store.getCollectionById(req.params.id);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found.' });
        return;
      }

      if (!req.file) {
        res
          .status(400)
          .json({ error: 'A PDF file must be provided in the "file" field.' });
        return;
      }

      const filename = sanitizeFilename(req.file.originalname);
      if (!filename || path.extname(filename).toLowerCase() !== '.pdf') {
        res.status(400).json({ error: 'Uploaded file must have a valid .pdf filename.' });
        return;
      }

      if (req.file.size === 0 || req.file.buffer.length === 0) {
        res.status(400).json({ error: 'Uploaded PDF file cannot be empty.' });
        return;
      }

      if (!hasPdfMagicHeader(req.file.buffer)) {
        res.status(400).json({
          error: 'File content is not a valid PDF document (missing %PDF- header).',
        });
        return;
      }

      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      const duplicate = await store.findDuplicateDocument(collection.id, {
        filename,
        sha256,
      });

      if (duplicate) {
        const reason =
          duplicate.sha256 === sha256
            ? `This exact PDF content already exists in this collection as "${duplicate.filename}".`
            : `A document named "${duplicate.filename}" already exists in this collection.`;
        res.status(409).json({ error: reason });
        return;
      }

      const documentId = crypto.randomUUID();
      const storageKey = await store.storeDocumentFile({
        collectionId: collection.id,
        documentId,
        buffer: req.file.buffer,
      });

      const record: DocumentRecord = {
        id: documentId,
        collectionId: collection.id,
        filename,
        mimeType: 'application/pdf',
        sizeBytes: req.file.size,
        sha256,
        pageCount: null,
        storageKey,
        status: 'pending_ingestion',
        uploadedAt: new Date().toISOString(),
        ingestion: null,
      };

      await store.saveDocumentMetadata(record);
      const updatedCollection = await store.getCollectionById(collection.id);

      res.status(201).json({
        document: record,
        collection: updatedCollection ?? collection,
      });
    } catch (error) {
      next(error);
    }
  },
);

collectionsRouter.get(
  '/collections/:id/documents/:documentId',
  async (req, res, next) => {
    try {
      const store = getDocumentStore();
      const collection = await store.getCollectionById(req.params.id);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found.' });
        return;
      }

      const document = await store.getDocumentById(req.params.documentId);
      if (!document || document.collectionId !== collection.id) {
        res.status(404).json({ error: 'Document not found in this collection.' });
        return;
      }

      res.json({ document });
    } catch (error) {
      next(error);
    }
  },
);

collectionsRouter.post(
  '/collections/:collectionId/documents/:documentId/ingest',
  async (req, res, next) => {
    try {
      const result = await ingestCollectionDocument(
        req.params.collectionId,
        req.params.documentId,
      );

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof IngestionNotFoundError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof IngestionConflictError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof PdfExtractionError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes('GEMINI_API_KEY')) {
        res.status(503).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

collectionsRouter.get(
  '/collections/:collectionId/documents/:documentId/ingestion',
  async (req, res, next) => {
    try {
      const documentStore = getDocumentStore();
      const vectorStore = getVectorStore();

      const collection = await documentStore.getCollectionById(req.params.collectionId);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found.' });
        return;
      }

      const document = await documentStore.getDocumentById(req.params.documentId);
      if (!document || document.collectionId !== collection.id) {
        res.status(404).json({ error: 'Document not found in this collection.' });
        return;
      }

      const vectorCount = await vectorStore.getDocumentVectorCount(
        collection.id,
        document.id,
      );

      const payload: DocumentIngestionStatusResponse = {
        document,
        vectorCount,
      };

      res.json(payload);
    } catch (error) {
      next(error);
    }
  },
);

collectionsRouter.delete(
  '/collections/:id/documents/:documentId',
  async (req, res, next) => {
    try {
      const store = getDocumentStore();
      const vectorStore = getVectorStore();

      const collection = await store.getCollectionById(req.params.id);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found.' });
        return;
      }

      const existing = await store.getDocumentById(req.params.documentId);
      if (!existing || existing.collectionId !== collection.id) {
        res.status(404).json({ error: 'Document not found in this collection.' });
        return;
      }

      if (isDocumentActivelyProcessing(existing.id)) {
        res.status(409).json({
          error: 'Cannot delete document while ingestion is actively running.',
        });
        return;
      }

      const removedVectors = await vectorStore.deleteDocumentVectors(
        collection.id,
        existing.id,
      );
      const deleted = await store.deleteDocument(existing.id);
      const updatedCollection = await store.getCollectionById(collection.id);

      res.json({
        deletedDocument: deleted,
        removedVectors,
        collection: updatedCollection ?? collection,
      });
    } catch (error) {
      next(error);
    }
  },
);
