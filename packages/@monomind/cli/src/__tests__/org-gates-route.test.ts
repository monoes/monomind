import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleOrgRoutes } from '../ui/routes-org.mjs';

function makeRes() {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, headers?: Record<string, string>) {
      res.statusCode = code;
      res.headers = headers || {};
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk;
    },
  };
  return res;
}

describe('GET /api/org/:name/gates', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-gates-route-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns gates sorted newest-first with a pending count', async () => {
    const orgDir = join(cwd, '.monomind', 'orgs', 'myorg');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(
      join(orgDir, 'gates.json'),
      JSON.stringify({
        gates: [
          {
            id: 'g1',
            name: 'ship v1',
            description: 'go/no-go',
            roleId: 'boss',
            status: 'approved',
            createdAt: 1000,
            resolvedBy: 'human',
            resolvedAt: 2000,
            resolution: 'ship it',
          },
          {
            id: 'g2',
            name: 'ship v2',
            description: 'go/no-go',
            roleId: 'boss',
            status: 'pending',
            createdAt: 3000,
          },
        ],
      }),
    );

    const req = {
      method: 'GET',
      url: `/api/org/myorg/gates?dir=${encodeURIComponent(cwd)}`,
    } as any;
    const res = makeRes();
    const handled = await handleOrgRoutes(req, res, '/api/org/myorg/gates', null, {
      projectDir: cwd,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pending).toBe(1);
    expect(body.gates).toHaveLength(2);
    expect(body.gates[0].id).toBe('g2'); // newest createdAt first
    expect(body.gates[1].resolution).toBe('ship it');
  });

  it('returns an empty list when gates.json does not exist', async () => {
    const req = {
      method: 'GET',
      url: `/api/org/myorg/gates?dir=${encodeURIComponent(cwd)}`,
    } as any;
    const res = makeRes();
    await handleOrgRoutes(req, res, '/api/org/myorg/gates', null, { projectDir: cwd });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ gates: [], pending: 0 });
  });

  it('rejects an invalid org name', async () => {
    const req = { url: '/api/org/../../etc/gates' } as any;
    const res = makeRes();
    // The route regex only matches valid org-name characters, so a path-traversal
    // attempt in the URL simply doesn't match this route at all (handled === false)
    // rather than reaching the 400 branch — routing dispatch already rejects it.
    const handled = await handleOrgRoutes(req, res, '/api/org/../../etc/gates', null, {
      projectDir: cwd,
    });
    expect(handled).toBe(false);
  });
});
