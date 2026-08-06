import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PASS_THRESHOLD } from './types';

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

export function shuffleMultipleChoiceChoices<T extends { type?: string; choices?: string[]; correctAnswer?: string | boolean }>(question: T): T {
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

/**
 * Returns a round-robin picker that walks through evenly-sized chunks of the
 * document so question generation covers the whole document instead of
 * repeatedly sampling the same section.
 */
export function createChunkRotator(
  text: string,
  chunkCount: number,
): () => string {
  const chunks = chunkDocument(text, chunkCount);
  let index = 0;
  return () => {
    if (chunks.length === 0) return text;
    const chunk = chunks[index % chunks.length];
    index += 1;
    return chunk;
  };
}

function normalizeAnswerText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const getBigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ab = getBigrams(a);
  const bb = getBigrams(b);
  let overlap = 0;
  for (const bg of ab) {
    if (bb.has(bg)) overlap++;
  }
  return (2 * overlap) / (ab.size + bb.size);
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let intersection = 0;
  for (const t of at) {
    if (bt.has(t)) intersection++;
  }
  return intersection / (at.size + bt.size - intersection);
}

/**
 * Deterministic grading for fill-in-the-blank answers — no model call.
 * Returns null when the answer cannot be graded locally (no correct answer
 * recorded, or a long sentence-shaped answer that needs semantic grading).
 */
export function gradeFillInTheBlank(
  userAnswer: string,
  correctAnswer: string,
): { isCorrect: boolean; score: number; feedback: string } | null {
  const expected = normalizeAnswerText(correctAnswer);
  const given = normalizeAnswerText(userAnswer);
  if (!expected || !given) {
    return null;
  }

  if (
    given === expected ||
    given.includes(expected) ||
    expected.includes(given)
  ) {
    return { isCorrect: true, score: 100, feedback: "Correct!" };
  }

  const expectedTokens = expected.split(" ").filter(Boolean);
  const givenTokens = given.split(" ").filter(Boolean);
  if (expectedTokens.every((t) => givenTokens.includes(t))) {
    return { isCorrect: true, score: 100, feedback: "Correct!" };
  }

  if (givenTokens.length > 3 && given.length > expected.length * 1.5) {
    return null;
  }

  const similarity = Math.max(
    bigramSimilarity(given, expected),
    tokenJaccardSimilarity(given, expected),
  );
  const score = Math.round(similarity * 100);
  return {
    isCorrect: score >= PASS_THRESHOLD,
    score,
    feedback:
      score >= PASS_THRESHOLD
        ? `Close! The expected answer is: ${correctAnswer}`
        : `Incorrect. The expected answer is: ${correctAnswer}`,
  };
}
