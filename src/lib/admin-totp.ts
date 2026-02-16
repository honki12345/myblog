import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function normalizeBase32Input(value: string): string {
  return value.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
}

function encodeBase32(bytes: Buffer): string {
  if (bytes.length === 0) {
    return "";
  }

  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = normalizeBase32Input(value);
  if (normalized.length === 0) {
    throw new Error("TOTP secret must not be empty.");
  }

  let bits = 0;
  let current = 0;
  const output: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error("TOTP secret must be base32.");
    }

    current = (current << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function deriveTotpSecretFromRaw(raw: string): string {
  const digest = createHash("sha256").update(raw).digest();
  return encodeBase32(digest).slice(0, 32);
}

function toCounterBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

function generateHotp(secret: Buffer, counter: number): string {
  const hmac = createHmac("sha1", secret)
    .update(toCounterBuffer(counter))
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function sanitizeTotpCode(input: string): string | null {
  const normalized = input.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeTotpSecret(input: string): string {
  const normalized = normalizeBase32Input(input);
  if (/^[A-Z2-7]{16,}$/.test(normalized)) {
    return normalized;
  }

  return deriveTotpSecretFromRaw(input.trim());
}

export function encryptTotpSecret(
  secret: string,
  encryptionKey: string,
): string {
  const key = deriveEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `v1.${iv.toString("base64url")}.${encrypted.toString(
    "base64url",
  )}.${authTag.toString("base64url")}`;
}

export function decryptTotpSecret(
  payload: string,
  encryptionKey: string,
): string {
  const [version, ivPart, encryptedPart, tagPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !encryptedPart || !tagPart) {
    throw new Error("Invalid encrypted TOTP secret format.");
  }

  const key = deriveEncryptionKey(encryptionKey);
  const iv = Buffer.from(ivPart, "base64url");
  const encrypted = Buffer.from(encryptedPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function generateTotpCode(secret: string, now = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  return generateHotp(key, counter);
}

export function verifyTotpCode(
  secret: string,
  inputCode: string,
  now = Date.now(),
): boolean {
  const code = sanitizeTotpCode(inputCode);
  if (!code) {
    return false;
  }

  const key = decodeBase32(secret);
  const currentCounter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);

  for (
    let counter = currentCounter - TOTP_WINDOW;
    counter <= currentCounter + TOTP_WINDOW;
    counter += 1
  ) {
    const expected = generateHotp(key, counter);
    const expectedBuffer = Buffer.from(expected);
    const inputBuffer = Buffer.from(code);
    if (
      expectedBuffer.length === inputBuffer.length &&
      timingSafeEqual(expectedBuffer, inputBuffer)
    ) {
      return true;
    }
  }

  return false;
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(code: string, sessionSecret: string): string {
  const normalized = normalizeRecoveryCode(code);
  return createHash("sha256")
    .update(sessionSecret)
    .update(":")
    .update(normalized)
    .digest("hex");
}
