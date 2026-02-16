import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse, requireAdminSessionWithCsrf } from "@/lib/admin-api";

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

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = requireAdminSessionWithCsrf(request);
  if ("response" in auth) {
    return auth.response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return adminErrorResponse(
      400,
      "INVALID_INPUT",
      "Request must be multipart/form-data.",
    );
  }
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return adminErrorResponse(400, "INVALID_INPUT", "file field is required.");
  }
  if (file.size <= 0) {
    return adminErrorResponse(400, "INVALID_INPUT", "Uploaded file is empty.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return adminErrorResponse(413, "INVALID_INPUT", "File size exceeds 5MB.", {
      maxBytes: MAX_FILE_SIZE_BYTES,
      size: file.size,
    });
  }

  const mimeType = file.type.toLowerCase();
  if (!isSupportedMimeType(mimeType)) {
    return adminErrorResponse(415, "INVALID_INPUT", "Unsupported file type.", {
      allowed: Object.keys(MIME_TO_EXTENSION),
    });
  }

  try {
    const fileBytes = Buffer.from(await file.arrayBuffer());
    if (!isValidMagicBytes(mimeType, fileBytes)) {
      return adminErrorResponse(
        415,
        "INVALID_INPUT",
        "Invalid file signature.",
      );
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
    return adminErrorResponse(500, "INTERNAL_ERROR", "Failed to upload file.");
  }
}
