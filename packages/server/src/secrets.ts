import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { DATA_DIR, SECRET_KEY } from "./config.js";

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (SECRET_KEY.trim()) {
    cachedKey = createHash("sha256").update(SECRET_KEY).digest();
    return cachedKey;
  }
  const file = path.join(DATA_DIR, "secret.key");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) {
    const generated = randomBytes(32).toString("base64");
    fs.writeFileSync(file, generated, { mode: 0o600 });
  }
  cachedKey = createHash("sha256").update(fs.readFileSync(file, "utf8").trim()).digest();
  return cachedKey;
}

export function encryptSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret<T>(payload: string): T | null {
  try {
    const [ivValue, tagValue, dataValue] = payload.split(".");
    if (!ivValue || !tagValue || !dataValue) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}
