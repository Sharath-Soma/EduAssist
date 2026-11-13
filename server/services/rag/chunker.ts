import type { DocumentChunk } from '../../../shared/types/knowledge.ts';
import type { PdfExtractionResult } from '../pdf/pdfProcessor.ts';

export interface ChunkingOptions {
  targetTokens: number;
  overlapTokens: number;
}

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  targetTokens: 800,
  overlapTokens: 120,
};

export interface DocumentChunker {
  chunkDocument(params: {
    documentId: string;
    collectionId: string;
    extraction: PdfExtractionResult;
    options?: ChunkingOptions;
  }): DocumentChunk[];
}

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }
  return Math.max(words.length, Math.ceil(words.length * 1.3));
}

function isLikelyHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    return false;
  }
  if (/^(#{1,6}\s|Section\s+\d+|Chapter\s+\d+|Unit\s+\d+|\d+(\.\d+)*\s+[A-Z])/i.test(trimmed)) {
    return true;
  }
  const lettersOnly = trimmed.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length >= 4 && lettersOnly === lettersOnly.toUpperCase()) {
    return true;
  }
  return false;
}

function splitIntoStructuralBlocks(pageText: string): string[] {
  const rawParagraphs = pageText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const blocks: string[] = [];

  for (const para of rawParagraphs) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    let currentLines: string[] = [];

    for (const line of lines) {
      if (isLikelyHeading(line) && currentLines.length > 0) {
        blocks.push(currentLines.join('\n'));
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      blocks.push(currentLines.join('\n'));
    }
  }

  return blocks;
}

function splitOversizedBlock(block: string, targetTokens: number): string[] {
  const sentences = block
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(\["'])/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    // Fallback word split when a single block has no sentence punctuation
    const words = block.split(/\s+/).filter(Boolean);
    const maxWords = Math.max(50, Math.floor(targetTokens / 1.3));
    const segments: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
      segments.push(words.slice(i, i + maxWords).join(' '));
    }
    return segments;
  }

  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer && estimateTokens(candidate) > targetTokens) {
      pieces.push(buffer);
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    pieces.push(buffer);
  }

  return pieces;
}

function extractOverlapTail(text: string, overlapTokens: number): string {
  if (overlapTokens <= 0) {
    return '';
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    const collected: string[] = [];
    let runningTokens = 0;
    for (let i = sentences.length - 1; i >= 0; i -= 1) {
      const sentence = sentences[i];
      const sentenceTokens = estimateTokens(sentence);
      if (collected.length > 0 && runningTokens + sentenceTokens > overlapTokens) {
        break;
      }
      collected.unshift(sentence);
      runningTokens += sentenceTokens;
      if (runningTokens >= overlapTokens) {
        break;
      }
    }
    const candidate = collected.join(' ').trim();
    if (candidate.length > 0 && candidate.length < text.length) {
      return candidate;
    }
  }

  const words = text.split(/\s+/).filter(Boolean);
  const overlapWordCount = Math.min(
    Math.floor(words.length * 0.5),
    Math.max(15, Math.floor(overlapTokens / 1.3)),
  );
  if (overlapWordCount <= 0) {
    return '';
  }
  return words.slice(-overlapWordCount).join(' ');
}

export class EducationalDocumentChunker implements DocumentChunker {
  chunkDocument(params: {
    documentId: string;
    collectionId: string;
    extraction: PdfExtractionResult;
    options?: ChunkingOptions;
  }): DocumentChunk[] {
    const options = params.options ?? DEFAULT_CHUNKING_OPTIONS;
    const chunks: DocumentChunk[] = [];
    let globalChunkIndex = 0;

    for (const page of params.extraction.pages) {
      const rawBlocks = splitIntoStructuralBlocks(page.text);
      const blocks: string[] = [];

      for (const block of rawBlocks) {
        if (estimateTokens(block) > options.targetTokens) {
          blocks.push(...splitOversizedBlock(block, options.targetTokens));
        } else {
          blocks.push(block);
        }
      }

      let currentParts: string[] = [];
      let currentTokens = 0;

      const flushCurrentChunk = (): string | null => {
        const content = currentParts.join('\n\n').trim();
        if (!content) {
          return null;
        }
        const chunkIndex = globalChunkIndex;
        globalChunkIndex += 1;

        chunks.push({
          id: `${params.documentId}:p${page.pageNumber}:c${chunkIndex}`,
          documentId: params.documentId,
          collectionId: params.collectionId,
          documentName: params.extraction.filename,
          pageNumber: page.pageNumber,
          chunkIndex,
          content,
          tokenCount: estimateTokens(content),
        });

        return content;
      };

      for (const block of blocks) {
        const blockTokens = estimateTokens(block);
        const startsNewMajorSection =
          isLikelyHeading(block.split('\n')[0] ?? '') &&
          currentTokens >= Math.floor(options.targetTokens * 0.55);

        if (
          currentParts.length > 0 &&
          (currentTokens + blockTokens > options.targetTokens || startsNewMajorSection)
        ) {
          const flushed = flushCurrentChunk();
          if (flushed && !startsNewMajorSection) {
            const overlap = extractOverlapTail(flushed, options.overlapTokens);
            if (overlap) {
              currentParts = [overlap, block];
              currentTokens = estimateTokens(currentParts.join('\n\n'));
            } else {
              currentParts = [block];
              currentTokens = blockTokens;
            }
          } else {
            currentParts = [block];
            currentTokens = blockTokens;
          }
        } else {
          currentParts.push(block);
          currentTokens = estimateTokens(currentParts.join('\n\n'));
        }
      }

      if (currentParts.length > 0) {
        flushCurrentChunk();
      }
    }

    return chunks;
  }
}

export const documentChunker: DocumentChunker = new EducationalDocumentChunker();
