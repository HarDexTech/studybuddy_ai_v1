import { NextRequest } from "next/server";
import { requireUserId } from "@/lib/auth";
import { addRecentDocument, getDocumentById } from "@/lib/storage";
import { extractServerDocument } from "@/lib/server-document-parser";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    await requireUserId();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { error: "INVALID_INPUT: a file field is required." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "FILE_TOO_LARGE: the maximum file size is 50MB." },
        { status: 413 },
      );
    }

    const parsed = await extractServerDocument(file);
    const id = crypto.randomUUID();
    const lastModified = Number(formData.get("lastModified")) || Date.now();

    await addRecentDocument({
      id,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      lastModified,
      text: parsed.text,
      structuredText: parsed.structuredText,
    });

    const document = await getDocumentById(id);
    return Response.json(document, { status: 201 });
  } catch (error) {
    console.error("[documents/parse] failed:", error);
    const message =
      error instanceof Error ? error.message : "SERVER_PARSE_FAILED";
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 422;
    return Response.json({ error: message }, { status });
  }
}
