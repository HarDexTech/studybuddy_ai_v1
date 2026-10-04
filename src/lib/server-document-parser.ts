import JSZip from "jszip";
import mammoth from "mammoth";
import { structureDocument } from "@/ai/flows/structure-document";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/[\u2610\u2611\u2612\u25A1\uFFFD\uE000-\uF8FF]/g, "-")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    text += `${pageText}\n\n`;
  }

  return cleanExtractedText(text);
}

async function extractPptx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slides: Array<{ number: number; text: string }> = [];
  const slideFiles = zip.folder("ppt/slides");

  if (!slideFiles) return "";

  const tasks: Promise<void>[] = [];
  slideFiles.forEach((relativePath, file) => {
    if (!relativePath.endsWith(".xml")) return;
    tasks.push(
      file.async("string").then((xml) => {
        const text = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
          .map((match) =>
            match[1]
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .trim(),
          )
          .filter(Boolean)
          .join(" ");
        const match = relativePath.match(/slide(\d+)\.xml$/);
        slides.push({ number: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER, text });
      }),
    );
  });

  await Promise.all(tasks);
  return slides
    .sort((a, b) => a.number - b.number)
    .map((slide) => `## Slide ${slide.number}\n\n${slide.text}`)
    .join("\n\n");
}

export async function extractServerDocument(
  file: File,
): Promise<{ text: string; structuredText?: string }> {
  const buffer = await file.arrayBuffer();
  let text: string;

  if (file.type === PDF_MIME) {
    text = await extractPdf(buffer);
  } else if (file.type === DOCX_MIME) {
    text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  } else if (file.type === PPTX_MIME) {
    text = await extractPptx(buffer);
  } else if (file.type.startsWith("text/")) {
    text = new TextDecoder().decode(buffer);
  } else {
    throw new Error(
      "UNSUPPORTED_SERVER_FILE: server parsing supports PDF, DOCX, PPTX, and text files.",
    );
  }

  const cleanedText = cleanExtractedText(text).trim();
  if (!cleanedText) {
    throw new Error("EMPTY_DOCUMENT: no text could be extracted.");
  }

  const shouldStructure =
    file.type === PDF_MIME || file.type === DOCX_MIME || file.type === PPTX_MIME;
  const structuredText = shouldStructure
    ? (await structureDocument(cleanedText)).trim()
    : undefined;

  return {
    text: cleanedText,
    structuredText: structuredText || undefined,
  };
}
