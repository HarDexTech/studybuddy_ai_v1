'use server';
/**
 * @fileOverview Document-structuring pass: takes raw extracted text and returns
 * markdown with ##/###/#### headings and lists added, WITHOUT summarizing or
 * condensing anything. Long documents are chunked and stitched back together.
 * Any failure falls back to the raw input text.
 */

import { callNimJsonStream } from '@/ai/api';

const SYSTEM =
  'You are a document structuring assistant. Your only job is to add markdown structure to the provided text.';

const USER_PROMPT = (text: string) => `Faithfully reproduce the text below in a raw markdown document.

RULES:
- Reproduce EVERY piece of content — every sentence, every number, every fact, every example, every table. Do NOT summarize, condense, omit, or paraphrase anything.
- Your only job is to add markdown structure based on what the text itself indicates:
  - Prefix titles, subtitles, and section names with ## / ### / #### headings.
  - Convert enumerated or itemized points into "- " bullet lists or numbered lists.
  - Keep paragraphs as paragraphs.
- Preserve any headings, list markers, or code blocks that are already present in the text.
- Do NOT add any content that is not in the source text. No introductions, commentary, summaries, or conclusions.

Return ONLY raw markdown. No JSON, no code fences, no preamble. Start directly with the text itself.

TEXT:
${text}`;

const MAX_CHUNK_CHARS = 6000;
const CHUNK_TIMEOUT_MS = 90_000;

function splitIntoChunks(text: string, maxChars: number): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const block of blocks) {
    if (block.length <= maxChars) {
      if (!current || (current + "\n\n" + block).length <= maxChars) {
        current = current ? current + "\n\n" + block : block;
      } else {
        push();
        current = block;
      }
      continue;
    }

    // Oversized block (e.g. dense PDF page): split by lines, keeping heading
    // boundaries where possible.
    push();
    const lines = block.split("\n");
    let buf = "";
    for (const line of lines) {
      if (buf && (buf + "\n" + line).length > maxChars) {
        chunks.push(buf.trim());
        buf = line;
      } else {
        buf = buf ? buf + "\n" + line : line;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  push();

  return chunks.length > 0 ? chunks : [text];
}

function maxOutputTokensFor(chunkLength: number): number {
  return Math.min(8192, Math.max(2048, Math.ceil(chunkLength / 3)));
}

async function structureChunk(text: string): Promise<string> {
  return await Promise.race([
    callNimJsonStream(SYSTEM, USER_PROMPT(text), {
      maxOutputTokens: maxOutputTokensFor(text.length),
      skipStripFences: true,
      thinkingDisabled: true,
    }),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error("STRUCTURE_TIMEOUT: structuring chunk timed out")),
        CHUNK_TIMEOUT_MS,
      ),
    ),
  ]);
}

export async function structureDocument(rawText: string): Promise<string> {
  const trimmed = rawText.trim();
  if (!trimmed) return rawText;

  try {
    const chunks = splitIntoChunks(trimmed, MAX_CHUNK_CHARS);
    const structuredParts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const part = await structureChunk(chunks[i]);
      const cleaned = part.trim();
      if (cleaned) structuredParts.push(cleaned);
    }
    return structuredParts.join("\n\n");
  } catch (error) {
    console.error("structureDocument failed, falling back to raw text:", error);
    return rawText;
  }
}
