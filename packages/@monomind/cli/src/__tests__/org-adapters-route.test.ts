import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_MODEL } from '../orgrt/vercel-providers.js';
import { handleOrgRoutes } from '../ui/routes-org.mjs';

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: '',
    writeHead(code: number) {
      res.statusCode = code;
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk;
    },
  };
  return res;
}

describe('GET /api/org/:name/adapters — default adapter', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-adapters-route-'));
    mkdirSync(join(cwd, '.monomind', 'orgs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const get = async () => {
    const url = '/api/org/myorg/adapters';
    const res = makeRes();
    await handleOrgRoutes({ method: 'GET', url } as any, res, url, null, {
      projectDir: cwd,
      _resolveOrgProjectDir: () => cwd,
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  it('falls back to the org runtime default Claude model', async () => {
    writeFileSync(join(cwd, '.monomind', 'orgs', 'myorg.json'), JSON.stringify({ name: 'myorg' }));
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.default_adapter).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it('honours run_config.ceo_adapter when the org sets one', async () => {
    writeFileSync(
      join(cwd, '.monomind', 'orgs', 'myorg.json'),
      JSON.stringify({ name: 'myorg', run_config: { ceo_adapter: 'claude-opus-5' } }),
    );
    const { body } = await get();
    expect(body.default_adapter).toBe('claude-opus-5');
  });
});
