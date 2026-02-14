import { timingSafeEqual } from "node:crypto";

export function verifyApiKey(input: string | null | undefined) {
  const expected = process.env.BLOG_API_KEY;

  if (!expected || !input) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const inputBuffer = Buffer.from(input);

  if (expectedBuffer.length !== inputBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, inputBuffer);
}
