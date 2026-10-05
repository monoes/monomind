import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { checkRuntimeReadiness } from '../commands/doctor-runtime-readiness.js';

let scratch: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});
it('reports installed unsupported runtimes using the executable override without running them', async () => {
  scratch = mkdtempSync(join(tmpdir(), 'doctor-runtime-'));
  const binary = join(scratch, 'interactive-cli');
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ version: '7.8.3', bin: { kilo: 'interactive-cli' } }),
  );
  writeFileSync(binary, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  vi.stubEnv('FREEBUFF_CLI_BIN', binary);
  vi.stubEnv('KILO_CLI_BIN', binary);
  const check = await checkRuntimeReadiness();
  expect(check.status).toBe('info');
  expect(check.message).toContain('freebuff is installed but automation is unavailable');
  expect(check.message).not.toContain('kilo is installed but automation is unavailable');
  expect(check.message).toContain('interactive-only');
});
it('does not report absent installations as ready', async () => {
  vi.stubEnv('FREEBUFF_CLI_BIN', '/missing-freebuff');
  vi.stubEnv('KILO_CLI_BIN', '/missing-kilo');
  expect(await checkRuntimeReadiness()).toMatchObject({
    status: 'pass',
    message: 'No installed runtimes have unverified execution transports.',
  });
});
