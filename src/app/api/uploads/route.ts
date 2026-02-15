import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBearerToken, verifyApiKey } from "@/lib/auth";

type ApiErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "INTERNAL_ERROR";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

type SupportedMimeType = keyof typeof MIME_TO_EXTENSION;

function isSupportedMimeType(value: string): value is SupportedMimeType {
  return Object.hasOwn(MIME_TO_EXTENSION, value);
}

function isValidMagicBytes(mimeType: SupportedMimeType, bytes: Buffer): boolean {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
      bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
    );
  }

  return (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) ||
      bytes.subarray(0, 6).equals(Buffer.from("GIF89a")))
  );
}

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? null,
      },
    },
    { status },
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!verifyApiKey(token)) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or missing API key.");
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return errorResponse(400, "INVALID_INPUT", "file field is required.");
  }

  if (file.size <= 0) {
    return errorResponse(400, "INVALID_INPUT", "Uploaded file is empty.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(413, "FILE_TOO_LARGE", "File size exceeds 5MB.", {
      maxBytes: MAX_FILE_SIZE_BYTES,
      size: file.size,
    });
  }

  const mimeType = file.type.toLowerCase();
  if (!isSupportedMimeType(mimeType)) {
    return errorResponse(415, "UNSUPPORTED_TYPE", "Unsupported file type.", {
      allowed: Object.keys(MIME_TO_EXTENSION),
    });
  }

  try {
    const fileBytes = Buffer.from(await file.arrayBuffer());

    if (!isValidMagicBytes(mimeType, fileBytes)) {
      return errorResponse(415, "UNSUPPORTED_TYPE", "Invalid file signature.");
    }

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");

    const extension = MIME_TO_EXTENSION[mimeType];
    const filename = `${randomUUID()}.${extension}`;
    const relativeUrl = `/uploads/${year}/${month}/${filename}`;

    const targetDirectory = path.join(process.cwd(), "uploads", year, month);
    const targetPath = path.join(targetDirectory, filename);

    await mkdir(targetDirectory, { recursive: true });
    await writeFile(targetPath, fileBytes);

    return NextResponse.json({ url: relativeUrl }, { status: 201 });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to upload file.");
  }
}
