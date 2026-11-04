import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateSettings } from '../init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';
import { monomindNpx } from '../platform-adapters/renderers/mcp.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
type Perms = { allow: string[]; deny: string[] };

const BROAD = ['Bash(node:*)', 'Bash(npx:*)', 'Bash(git config:*)', 'Bash(git push)'];
const DENIED = [
  'Write(./.claude/settings*)',
  'Edit(./.claude/settings*)',
  'Write(./.git/hooks/**)',
  'Bash(git config core.hooksPath*)',
  'Bash(git config core.sshCommand*)',
];

function check(p: Perms): void {
  for (const b of BROAD) expect(p.allow).not.toContain(b);
  expect(p.allow).toContain('Bash(node .claude/helpers/*)');
  for (const d of DENIED) expect(p.deny).toContain(d);
}

describe('permission allow/deny hardening', () => {
  it('generated settings are narrow and deny self-modification', () => {
    check((generateSettings(DEFAULT_INIT_OPTIONS) as { permissions: Perms }).permissions);
  });
  it('allows the pinned npx form generated hooks and guidance use', () => {
    const { allow } = (generateSettings(DEFAULT_INIT_OPTIONS) as { permissions: Perms })
      .permissions;
    expect(allow).toContain('Bash(npx -y --package=@monoes/monomindcli@* monomind *)');
    // Must match what monomindNpx() actually emits for a pinned version.
    expect(monomindNpx('1.2.3')).toBe('npx -y --package=@monoes/monomindcli@1.2.3 monomind');
  });
  it('the committed .claude/settings.json matches', () => {
    const s = JSON.parse(readFileSync(join(REPO_ROOT, '.claude', 'settings.json'), 'utf8'));
    check(s.permissions);
    expect(s.permissions.allow).not.toContain('Bash(npx monomind*)');
    expect(s.permissions.allow).toContain('Bash(npx monomind@*)');
  });
});
