import crypto from "node:crypto";
import { requiredEnv } from "@/lib/env";

function getEncryptionKey() {
  const configured = requiredEnv("APP_ENCRYPTION_KEY");
  const decoded = Buffer.from(configured, "base64");

  if (decoded.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return decoded;
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function signValue(value: string): string {
  return crypto.createHmac("sha256", requiredEnv("APP_SECRET")).update(value).digest("base64url");
}
