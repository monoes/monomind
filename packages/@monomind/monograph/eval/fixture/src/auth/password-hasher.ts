export function hashPassword(plain: string): string {
  return `hashed:${plain}`;
}
export function verifyPassword(plain: string, hash: string): boolean {
  return hashPassword(plain) === hash;
}
