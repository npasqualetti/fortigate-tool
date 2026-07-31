import crypto from "node:crypto";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `pbkdf2:${ITERATIONS}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, iterations, salt, hash] = storedHash.split(":");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) {
    return false;
  }

  const candidate = crypto
    .pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST)
    .toString("base64url");

  if (candidate.length !== hash.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}
