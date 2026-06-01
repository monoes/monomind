import { describe, it, expect } from 'vitest';
import { isSensitiveFile } from '../../src/security/sensitive-files.js';

describe('isSensitiveFile', () => {
  it('blocks .env files', () => {
    expect(isSensitiveFile('.env')).toBe(true);
    expect(isSensitiveFile('.env.local')).toBe(true);
    expect(isSensitiveFile('/repo/.env.production')).toBe(true);
  });

  it('blocks private key files', () => {
    expect(isSensitiveFile('id_rsa')).toBe(true);
    expect(isSensitiveFile('id_ed25519')).toBe(true);
    expect(isSensitiveFile('server.key')).toBe(true);
    expect(isSensitiveFile('cert.pem')).toBe(true);
  });

  it('blocks credential and secret patterns', () => {
    expect(isSensitiveFile('aws_credentials')).toBe(true);
    expect(isSensitiveFile('credentials.json')).toBe(true);
    expect(isSensitiveFile('secret.yaml')).toBe(true);
    expect(isSensitiveFile('secrets.toml')).toBe(true);
    expect(isSensitiveFile('.netrc')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(isSensitiveFile('src/auth.ts')).toBe(false);
    expect(isSensitiveFile('config/database.ts')).toBe(false);
    expect(isSensitiveFile('README.md')).toBe(false);
    expect(isSensitiveFile('token-manager.ts')).toBe(false);
  });
});
