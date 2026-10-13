// The org eval scenarios start real daemons and sandboxed child processes, so a
// loaded machine (a parallel full suite, a second vitest run) takes far longer
// than the 30 s default; widen the budget for tests/eval only. The waits inside
// them still return as soon as their condition holds.
import { expect, vi } from 'vitest';

const file = expect.getState().testPath ?? '';
if (/[\\/]tests[\\/]eval[\\/]/.test(file))
  vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });
