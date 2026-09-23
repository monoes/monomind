import { afterEach, describe, expect, it, vi } from 'vitest';

const localEnv = { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' };

afterEach(() => {
  vi.doUnmock('node:module');
  vi.resetModules();
});

describe('pickWithJev', () => {
  it('reports a picker failure through onError before answering "no decision"', async () => {
    const { pickWithJev } = await import('../../src/decision/jev.js');
    const onError = vi.fn();
    const catalogs = {
      get agents(): never {
        throw new Error('catalog blew up');
      },
    };
    expect(await pickWithJev('task', catalogs, { env: localEnv, onError })).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('catalog blew up');
  });
});

describe('helper load error', () => {
  it('doctor shows why jev-picker.cjs failed to load instead of calling it missing', async () => {
    vi.doMock('node:module', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:module')>()),
      createRequire: () => () => {
        throw new SyntaxError('Unexpected token in jev-picker.cjs');
      },
    }));
    const { checkDecisionModel } = await import('../../src/commands/doctor-decision-checks.js');
    const r = await checkDecisionModel({ env: localEnv });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('Unexpected token in jev-picker.cjs');
    expect(r.message).not.toContain('missing');
  });
});
