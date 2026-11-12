import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import type { ControlTlsStatus } from "@sm/shared";
import { SSL_CERT_FILE, SSL_DIR, SSL_HOSTS, SSL_KEY_FILE } from "./config.js";

export interface ControlTls {
  key: Buffer;
  cert: Buffer;
  status: ControlTlsStatus;
}

let activeTls: ControlTls | null = null;

function resolveSslPath(value: string | undefined, fallbackName: string): string {
  if (!value) return path.join(SSL_DIR, fallbackName);
  return path.isAbsolute(value) ? value : path.resolve(SSL_DIR, value);
}

function certificateStatus(
  certFile: string,
  keyFile: string,
  cert: Buffer,
  source: ControlTlsStatus["source"],
): ControlTlsStatus {
  let parsed: X509Certificate;
  try {
    parsed = new X509Certificate(cert);
  } catch (error) {
    throw new Error(`Could not parse HTTPS certificate ${certFile}: ${(error as Error).message}`);
  }
  const validFrom = new Date(parsed.validFrom);
  const validTo = new Date(parsed.validTo);
  const daysRemaining = Math.ceil((validTo.getTime() - Date.now()) / 86_400_000);
  let selfSigned = parsed.subject === parsed.issuer;
  try {
    selfSigned = parsed.checkIssued(parsed);
  } catch {
    // Fall back to comparing the subject and issuer.
  }
  const warnings: string[] = [];
  if (source === "generated") {
    warnings.push(
      "This server generated a self-signed HTTPS certificate automatically. Browsers and devices will show a trust warning until a trusted certificate is provided.",
    );
  } else if (selfSigned) {
    warnings.push(
      "The configured HTTPS certificate is self-signed. Browsers and devices will show a trust warning.",
    );
  }
  if (Number.isFinite(daysRemaining)) {
    if (daysRemaining < 0) {
      warnings.push("The HTTPS certificate has expired. Replace it and restart the server.");
    } else if (daysRemaining <= 30) {
      warnings.push(
        `The HTTPS certificate expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Renew it soon.`,
      );
    }
  }
  return {
    source,
    selfSigned,
    sslDir: SSL_DIR,
    certFile,
    keyFile,
    subject: parsed.subject,
    issuer: parsed.issuer,
    validFrom: Number.isNaN(validFrom.getTime()) ? parsed.validFrom : validFrom.toISOString(),
    validTo: Number.isNaN(validTo.getTime()) ? parsed.validTo : validTo.toISOString(),
    daysRemaining: Number.isFinite(daysRemaining) ? daysRemaining : 0,
    warnings,
  };
}

function sanEntries(): string[] {
  const dns = new Set<string>(["localhost"]);
  const ips = new Set<string>(["127.0.0.1", "::1"]);
  const hostname = os.hostname().trim();
  if (hostname) dns.add(hostname);
  for (const configured of SSL_HOSTS) {
    if (net.isIP(configured)) ips.add(configured);
    else if (/^[a-z0-9._-]+$/i.test(configured)) dns.add(configured);
  }
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (net.isIP(entry.address)) ips.add(entry.address);
    }
  }
  return [
    ...[...dns].filter(Boolean).map((host) => `DNS:${host}`),
    ...[...ips].map((ip) => `IP:${ip}`),
  ];
}

function generateSelfSigned(certFile: string, keyFile: string): void {
  fs.mkdirSync(path.dirname(certFile), { recursive: true });
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const args = [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "825",
    "-keyout",
    keyFile,
    "-out",
    certFile,
    "-subj",
    "/CN=Service Maestro Local",
    "-addext",
    `subjectAltName=${sanEntries().join(",")}`,
  ];
  try {
    execFileSync("openssl", args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30_000,
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(
      `Could not generate a local HTTPS certificate with openssl.${stderr ? ` ${stderr}` : ""} Provide cert.pem and key.pem in ${SSL_DIR}, or set SM_SSL_CERT_FILE and SM_SSL_KEY_FILE.`,
    );
  }
  try {
    fs.chmodSync(keyFile, 0o600);
  } catch {
    // The filesystem may not support Unix permissions; reading the key still works.
  }
}

export async function prepareControlTls(): Promise<ControlTls> {
  if (activeTls) return activeTls;
  fs.mkdirSync(SSL_DIR, { recursive: true });
  const certFile = resolveSslPath(SSL_CERT_FILE, "cert.pem");
  const keyFile = resolveSslPath(SSL_KEY_FILE, "key.pem");
  const hasCert = fs.existsSync(certFile);
  const hasKey = fs.existsSync(keyFile);
  if (hasCert !== hasKey) {
    throw new Error(
      `HTTPS certificate files are incomplete: ${hasCert ? "certificate exists but key is missing" : "key exists but certificate is missing"} (${certFile}, ${keyFile}). Provide both files or remove both to generate a local certificate.`,
    );
  }
  let source: ControlTlsStatus["source"] = "provided";
  if (!hasCert && !hasKey) {
    generateSelfSigned(certFile, keyFile);
    source = "generated";
  }
  const cert = fs.readFileSync(certFile);
  const key = fs.readFileSync(keyFile);
  const status = certificateStatus(certFile, keyFile, cert, source);
  activeTls = { cert, key, status };
  return activeTls;
}

export function getControlTlsStatus(): ControlTlsStatus | null {
  return activeTls?.status ?? null;
}
