import { describe, expect, it, vi } from 'vitest';
import { checkDecisionModel, checkDecisionModelIfConfigured } from '../../src/commands/doctor-decision-checks.js';

const noulOk = () =>
  new Response(JSON.stringify({ model: 'x', answers: { probe: { type: 'noul', noul: 0.9 } } }), { status: 200 });

describe('checkDecisionModelIfConfigured', () => {
  it('adds no doctor row when no Jev env is set', async () => {
    expect(await checkDecisionModelIfConfigured({ TYPESAFE_API_KEY: 'k' })).toEqual([]);
  });
  it('adds the config row when Jev env is set', async () => {
    const rows = await checkDecisionModelIfConfigured({ MONOMIND_JEV_URL: 'http://127.0.0.1:3000' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pass');
  });
});

describe('checkDecisionModel', () => {
  it('reports info when nothing is configured', async () => {
    const r = await checkDecisionModel({ env: {} });
    expect(r.status).toBe('info');
    expect(r.message).toMatch(/Not configured/);
  });

  it('reports info when disabled', async () => {
    const r = await checkDecisionModel({ env: { MONOMIND_JEV: 'off', TYPESAFE_API_KEY: 'k' } });
    expect(r).toMatchObject({ status: 'info', message: 'Disabled (MONOMIND_JEV=off)' });
  });

  it('warns about an unusable MONOMIND_JEV_URL', async () => {
    const r = await checkDecisionModel({ env: { MONOMIND_JEV_URL: 'ftp://x' } });
    expect(r.status).toBe('warn');
    expect(r.fix).toContain('MONOMIND_JEV_URL=http://');
  });

  it('makes no network call without probe', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await checkDecisionModel({ env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' }, fetchImpl });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('custom (http://127.0.0.1:3000)');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes when every provider answers the probe', async () => {
    const fetchImpl = vi.fn(async () => noulOk()) as unknown as typeof fetch;
    const r = await checkDecisionModel({
      probe: true,
      env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000', TYPESAFE_API_KEY: 'k', MONOMIND_JEV_HOSTED: '1' },
      fetchImpl,
    });
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/custom \d+ms · typesafe \d+ms/);
  });

  it('warns with a fix when no provider answers, without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const r = await checkDecisionModel({ probe: true, env: { TYPESAFE_API_KEY: 'hidden7', MONOMIND_JEV_HOSTED: '1' }, fetchImpl });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('typesafe: HTTP 401');
    expect(r.message).not.toContain('hidden7');
    expect(r.fix).toBeDefined();
  });
});
