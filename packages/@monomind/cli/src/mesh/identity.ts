import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Per-registration secret the hub hands back at `hello`. */
export function issueKey(): string {
  return randomBytes(32).toString('hex');
}

export function keysMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** What the store keeps instead of the key, so the database never holds a usable secret. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
