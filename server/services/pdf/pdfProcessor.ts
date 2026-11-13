import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

const workerPath = path.resolve(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
);
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  filename: string;
  totalPages: number;
  extractedPages: number;
  emptyPages: number;
  pages: ExtractedPdfPage[];
}

export class PdfExtractionError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 422) {
    super(message);
    this.name = 'PdfExtractionError';
    this.statusCode = statusCode;
  }
}

export interface PdfExtractor {
  extractPages(buffer: Buffer, filename: string): Promise<PdfExtractionResult>;
}

function cleanPageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // Strip ASCII control chars except newline and tab
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assemblePageLines(items: Array<TextItem | { type: string }>): string {
  const lines: string[] = [];
  let currentLine = '';
  let previousY: number | null = null;
  let previousHeight = 12;

  for (const item of items) {
    if (!('str' in item)) {
      continue;
    }

    const text = item.str;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const currentY: number | null =
      typeof transform[5] === 'number' ? transform[5] : previousY;
    const fontHeight =
      typeof item.height === 'number' && item.height > 0 ? item.height : previousHeight;

    if (previousY !== null && currentY !== null) {
      const yDelta = Math.abs(previousY - currentY);
      const lineThreshold = Math.max(4, Math.min(fontHeight, previousHeight) * 0.55);

      if (yDelta > lineThreshold) {
        if (currentLine.trim().length > 0) {
          lines.push(currentLine.trim());
        }
        // Larger vertical gap indicates a new paragraph or section heading
        if (yDelta > Math.max(fontHeight, previousHeight) * 1.65) {
          lines.push('');
        }
        currentLine = '';
      }
    }

    if (text.length > 0) {
      const needsSpace =
        currentLine.length > 0 &&
        !currentLine.endsWith(' ') &&
        !text.startsWith(' ');
      currentLine += needsSpace ? ` ${text}` : text;
    }

    if (item.hasEOL) {
      if (currentLine.trim().length > 0) {
        lines.push(currentLine.trim());
      }
      currentLine = '';
    }

    if (currentY !== null) {
      previousY = currentY;
    }
    previousHeight = fontHeight;
  }

  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trim());
  }

  return cleanPageText(lines.join('\n'));
}

export class PdfJsExtractor implements PdfExtractor {
  async extractPages(buffer: Buffer, filename: string): Promise<PdfExtractionResult> {
    if (!buffer || buffer.length === 0) {
      throw new PdfExtractionError(`Cannot extract text: "${filename}" is empty.`, 422);
    }

    const standardFontDataUrl = `${pathToFileURL(
      path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts'),
    ).href}/`;

    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    let pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> | null =
      null;

    try {
      loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        standardFontDataUrl,
        verbosity: 0,
      });

      pdfDocument = await loadingTask.promise;
      const totalPages = pdfDocument.numPages;

      if (totalPages === 0) {
        throw new PdfExtractionError(
          `PDF "${filename}" contains zero pages.`,
          422,
        );
      }

      const pages: ExtractedPdfPage[] = [];
      let emptyPages = 0;

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const pageText = assemblePageLines(
            content.items as Array<TextItem | { type: string }>,
          );

          if (pageText.length === 0) {
            emptyPages += 1;
          } else {
            pages.push({
              pageNumber,
              text: pageText,
            });
          }
        } finally {
          page.cleanup();
        }
      }

      const extractedPages = pages.length;

      if (extractedPages === 0) {
        throw new PdfExtractionError(
          `No extractable text was found in "${filename}" across ${totalPages} page(s). This PDF may be scanned or image-only without an OCR text layer.`,
          422,
        );
      }

      return {
        filename,
        totalPages,
        extractedPages,
        emptyPages,
        pages,
      };
    } catch (error) {
      if (error instanceof PdfExtractionError) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : 'Unknown PDF error';
      throw new PdfExtractionError(
        `Failed to extract text from "${filename}": ${detail}`,
        422,
      );
    } finally {
      if (pdfDocument) {
        await pdfDocument.cleanup();
      }
      if (loadingTask) {
        await loadingTask.destroy();
      }
    }
  }
}

export const pdfExtractor: PdfExtractor = new PdfJsExtractor();
