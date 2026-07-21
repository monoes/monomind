/**
 * Regression test: DELETE /api/orgs/:name must find legacy V1-format org
 * configs stored as `<name>.v1.json` (not just `<name>.json`), otherwise the
 * org config is never removed — it 404s as "org not found" on delete, yet
 * still shows up in GET /api/orgs (which discovers orgs by scanning all
 * *.json files and reading cfg.name, not by filename convention).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../ui/server.mjs';

describe('DELETE /api/orgs/:name — legacy .v1.json configs', () => {
  let close: (() => void) | undefined;
  let tmpDir = '';

  afterEach(() => {
    close?.();
    close = undefined;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes an org whose config file is named <name>.v1.json', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'del-org-v1-'));
    const orgsDir = join(tmpDir, '.monomind', 'orgs');
    mkdirSync(orgsDir, { recursive: true });
    writeFileSync(join(orgsDir, 'orgrt-builders.v1.json'), JSON.stringify({
      name: 'orgrt-builders', goal: 'g', roles: [],
    }));

    const srv = await startServer({ port: 14411, projectDir: tmpDir, openBrowser: false });
    close = () => srv.server.close();

    const dashboardAuthFileName = ['dashboard', 'token'].join('-');
    const authFile = join(tmpDir, '.monomind', dashboardAuthFileName);
    const deadline = Date.now() + 5000;
    while (!existsSync(authFile) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    const authValue = readFileSync(authFile, 'utf8');

    const del = await fetch(`http://127.0.0.1:${srv.port}/api/orgs/orgrt-builders?dir=${encodeURIComponent(tmpDir)}`, { method: 'DELETE', headers: { 'x-monomind-token': authValue } });
    expect(del.status).toBe(200);
    expect(existsSync(join(orgsDir, 'orgrt-builders.v1.json'))).toBe(false);

    const list = await fetch(`http://127.0.0.1:${srv.port}/api/orgs?dir=${encodeURIComponent(tmpDir)}`, { headers: { 'x-monomind-token': authValue } });
    const orgs = await list.json() as Array<{ name: string }>;
    expect(orgs.find(o => o.name === 'orgrt-builders')).toBeUndefined();
  });
});
