import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shuffleArray<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function shuffleMultipleChoiceChoices<T extends { type: string; choices?: string[]; correctAnswer?: string | boolean }>(question: T): T {
  if (question.type !== 'multiple choice' || !Array.isArray(question.choices) || question.choices.length < 2) {
    return question;
  }

  return {
    ...question,
    choices: shuffleArray(question.choices),
  };
}

export function chunkDocument(text: string, chunkCount: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [trimmed];

  const targetChunks = Math.max(1, Math.min(chunkCount, paragraphs.length));
  const totalLength = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const targetSize = Math.max(1, Math.ceil(totalLength / targetChunks));

  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    currentChunk.push(paragraph);
    currentSize += paragraph.length;

    const enoughForChunk = currentSize >= targetSize;
    const remainingParagraphs = paragraphs.length - i - 1;
    const remainingChunks = targetChunks - chunks.length - 1;
    const shouldFlush = enoughForChunk && remainingParagraphs >= remainingChunks;

    if (shouldFlush) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentSize = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks.filter(Boolean);
}

export function pickRandomDocumentChunk(text: string, chunkCount = 7): string {
  const chunks = chunkDocument(text, chunkCount);
  if (chunks.length === 0) return text;
  const index = Math.floor(Math.random() * chunks.length);
  return chunks[index];
}
