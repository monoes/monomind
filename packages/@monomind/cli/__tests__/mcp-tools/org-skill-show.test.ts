/**
 * `org_skill_show` — read one Org-library skill over MCP, so a picked Org
 * skill is usable without a global `monomind` on PATH.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orgSkillShowTool } from '../../src/mcp-tools/org-skill-tools.js';
import { callMCPTool, listMCPTools } from '../../src/mcp-client.js';
import { newRoot, tamper, writeEntry } from '../catalog/fixtures.js';

let root = '';
beforeEach(() => {
  const home = newRoot('org-show-home-');
  vi.stubEnv('HOME', home);
  vi.stubEnv('MONOMIND_HOME', join(home, '.monomind'));
  root = newRoot('org-show-root-');
  vi.stubEnv('MONOMIND_CWD', root);
  const dir = join(root, '.monomind', 'org-skills', 'zorbling-tuning');
  mkdirSync(join(dir, 'ref'), { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: zorbling-tuning\ndescription: Tune zorbling flux\ntags: [ops, flux]\ntools: [monograph_query]\n---\nZORB BODY\n',
  );
  writeFileSync(join(dir, 'ref', 'notes.md'), 'notes');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const show = (input: unknown): Promise<any> => orgSkillShowTool.handler(input as never);
/** An error reaches the client as an MCP error result: isError plus `{ error }` text. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorOf = (res: any): string | undefined => {
  expect(res.isError).toBe(true);
  return JSON.parse(res.content[0].text).error;
};

describe('org_skill_show', () => {
  it('is advertised by default and callable by name through the MCP client', async () => {
    expect(orgSkillShowTool.inputSchema.required).toEqual(['name']);
    expect((await listMCPTools()).map((t) => t.name)).toContain('org_skill_show');
    expect(await callMCPTool('org_skill_show', { name: 'zorbling-tuning' })).toMatchObject({
      name: 'zorbling-tuning',
      origin: 'project',
    });
  });

  it('returns a project skill with body and reference files', async () => {
    const res = await show({ name: 'zorbling-tuning' });
    expect(res).toEqual({
      name: 'zorbling-tuning',
      description: 'Tune zorbling flux',
      tags: ['ops', 'flux'],
      tools: ['monograph_query'],
      origin: 'project',
      body: expect.stringContaining('ZORB BODY'),
      files: ['ref/notes.md'],
    });
    expect(res).not.toHaveProperty('dir');
  });

  it('reports an unknown skill', async () => {
    expect(errorOf(await show({ name: 'no-such-skill-xyz' }))).toBe('unknown org skill: no-such-skill-xyz');
  });

  it('rejects names that are not skill names (path traversal included)', async () => {
    for (const name of ['../zorbling-tuning', '..', 'a/b', 'Zorbling', '', '-x', 'x'.repeat(65)]) {
      expect(errorOf(await show({ name })), name).toMatch(/^invalid input/);
    }
    expect(errorOf(await show({}))).toMatch(/^invalid input/);
  });

  it('reads catalog skills only while active for org and verified', async () => {
    writeEntry(root, { name: 'cat-org', targets: ['org'] });
    writeEntry(root, { name: 'cat-platform-only', targets: ['platform:claude'] });
    writeEntry(root, { name: 'cat-disabled', targets: ['org'], status: 'disabled' });
    tamper(writeEntry(root, { name: 'cat-tampered', targets: ['org'] }));
    const ok = await show({ name: 'cat-org' });
    expect(ok).toMatchObject({ name: 'cat-org', origin: 'catalog' });
    expect(ok.body).toContain('BODY-SENTINEL for cat-org');
    for (const name of ['cat-platform-only', 'cat-disabled', 'cat-tampered'])
      expect(errorOf(await show({ name }))).toBe(`unknown org skill: ${name}`);
  });
});
