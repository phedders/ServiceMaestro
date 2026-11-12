import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PasskeySummary } from "@sm/shared";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import { db } from "./db.js";
import { WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME } from "./config.js";

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const challenges = new Map<string, { challenge: string; expiresAt: number }>();
const CHALLENGE_TTL_MS = 5 * 60_000;

function parseTransports(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function mapPasskey(row: PasskeyRow): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function listPasskeys(userId: string): PasskeySummary[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports, name,
              created_at, last_used_at
       FROM passkeys WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .all(userId) as PasskeyRow[];
  return rows.map(mapPasskey);
}

export function listPasskeyRows(userId: string): PasskeyRow[] {
  return db
    .prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports, name,
              created_at, last_used_at
       FROM passkeys WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .all(userId) as PasskeyRow[];
}

export function getPasskeyByCredential(
  userId: string,
  credentialId: string,
): PasskeyRow | null {
  return (
    (db
      .prepare(
        `SELECT id, user_id, credential_id, public_key, counter, transports, name,
                created_at, last_used_at
         FROM passkeys WHERE user_id = ? AND credential_id = ?`,
      )
      .get(userId, credentialId) as PasskeyRow | undefined) ?? null
  );
}

export function storePasskey(
  userId: string,
  credential: WebAuthnCredential,
  name: string,
): PasskeySummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO passkeys
       (id, user_id, credential_id, public_key, counter, transports, name, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    userId,
    credential.id,
    Buffer.from(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    name.trim() || "Passkey",
    now,
  );
  return mapPasskey(
    db
      .prepare(
        `SELECT id, user_id, credential_id, public_key, counter, transports, name,
                created_at, last_used_at FROM passkeys WHERE id = ?`,
      )
      .get(id) as PasskeyRow,
  );
}

export function updatePasskeyUsage(userId: string, credentialId: string, counter: number): void {
  db.prepare(
    "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE user_id = ? AND credential_id = ?",
  ).run(counter, new Date().toISOString(), userId, credentialId);
}

export function deletePasskey(userId: string, id: string): boolean {
  return (
    db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(id, userId).changes > 0
  );
}

export function toWebAuthnCredential(row: PasskeyRow): WebAuthnCredential {
  return {
    id: row.credential_id,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: parseTransports(row.transports),
  };
}

export function storeChallenge(key: string, challenge: string): void {
  const now = Date.now();
  for (const [entryKey, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(entryKey);
  }
  challenges.set(key, { challenge, expiresAt: now + CHALLENGE_TTL_MS });
}

export function takeChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}

export function relyingParty(request: FastifyRequest): {
  rpID: string;
  origin: string;
  rpName: string;
} {
  const headerOrigin =
    typeof request.headers.origin === "string" ? request.headers.origin : null;
  let origin = WEBAUTHN_ORIGIN ?? headerOrigin;
  if (!origin) {
    const host = request.headers.host ?? request.hostname;
    origin = `${request.protocol}://${host}`;
  }
  let rpID = WEBAUTHN_RP_ID;
  try {
    const url = new URL(origin);
    origin = url.origin;
    rpID ??= url.hostname;
  } catch {
    rpID ??= request.hostname;
  }
  return { rpID: rpID ?? request.hostname, origin, rpName: WEBAUTHN_RP_NAME };
}
