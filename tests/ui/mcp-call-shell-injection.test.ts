/**
 * The dashboard `/api/mcp/call` bridge runs a handful of monograph tools by
 * shelling out to git. Two of them interpolated raw POST-body values straight
 * into the shell command (issue #82):
 *
 *   - `monograph_author_analytics` interpolated `input.limit` into `head -${limit}`
 *   - `monograph_churn_hotspots` interpolated `input.since` into `--since="${since}"`
 *
 * A body like { "limit": "1; rm -rf ~ #" } or { "since": 'x"; id; "' } was a
 * remote command execution. The handlers must clamp `limit` to a bounded
 * integer and whitelist `since` to a relative-date format before either value
 * reaches the shell.
 *
 * server.mjs is one ~4k-line module whose handlers live inside a request
 * listener closure, so there is no unit to import. Like the cost-honesty
 * tests, these assertions run against the shipped source itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SERVER = join(
  process.cwd(),
  'packages/@monomind/cli/src/ui/server.mjs',
);

const src = readFileSync(SERVER, 'utf-8');

function handlerBlock(tool: string): string {
  const start = src.indexOf(`tool === '${tool}'`);
  if (start < 0) throw new Error(`${tool} handler not found — was it renamed?`);
  const end = src.indexOf(`} else if (tool ===`, start + 1);
  return src.slice(start, end < 0 ? undefined : end);
}

describe('/api/mcp/call shell command construction (issue #82)', () => {
  it('author_analytics clamps limit to a bounded integer before the shell', () => {
    const block = handlerBlock('monograph_author_analytics');
    // parseInt + Math.min clamp, mirroring the sibling handlers' style.
    expect(block).toMatch(/parseInt\(input\.limit/);
    expect(block).toMatch(/Math\.min\(/);
    // The vulnerable form: raw input.limit interpolated into `head -...`.
    expect(block).not.toMatch(/head -\$\{input\.limit\}/);
    expect(block).not.toMatch(/const limit = input\.limit \|\| 20;/);
  });

  it('churn_hotspots whitelists the since format before the shell', () => {
    const block = handlerBlock('monograph_churn_hotspots');
    // Only "N day(s)/week(s)/month(s)/year(s) ago" may reach --since="...".
    expect(block).toMatch(/\^\\d\+ \(day\|week\|month\|year\)s\? ago\$/);
    // The vulnerable form: raw input.since reaching the shell string.
    expect(block).not.toMatch(/const since = input\.since \|\|/);
  });

  it('no execSync template literal interpolates raw request input', () => {
    // Scan every execSync-style template literal in the file: any ${...}
    // interpolation must reference a sanitized local (limit/since/pid), never
    // an input.* property directly.
    const execTemplates = src.match(/exec\w*\(`[^`]*`\s*[,)]/g) ?? [];
    expect(execTemplates.length).toBeGreaterThan(0);
    for (const tpl of execTemplates) {
      expect(tpl, `raw request input in shell command: ${tpl}`).not.toMatch(/\$\{[^}]*input\./);
    }
  });

  it('server.mjs stays parseable', () => {
    // The edits touched template literals inside a large handler chain, which
    // are easy to break and would otherwise only surface at request time.
    // server.mjs is ESM (import.meta), so `new Function` cannot check it —
    // ask node itself to parse it instead.
    execFileSync(process.execPath, ['--check', SERVER]);
  });
});
