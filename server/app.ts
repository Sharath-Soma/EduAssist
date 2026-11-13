import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { assistantRouter } from './routes/assistant.ts';
import {
  collectionsRouter,
  MAX_PDF_SIZE_BYTES,
  UploadValidationError,
} from './routes/collections.ts';
import { healthRouter } from './routes/health.ts';

export function createApiApp(): express.Express {
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  app.use('/api', healthRouter);
  app.use('/api', collectionsRouter);
  app.use('/api', assistantRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof UploadValidationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const limitMb = Math.round(MAX_PDF_SIZE_BYTES / (1024 * 1024));
        res
          .status(413)
          .json({ error: `PDF exceeds the maximum allowed size of ${limitMb} MB.` });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal server error.';
    res.status(500).json({ error: message });
  });

  return app;
}
