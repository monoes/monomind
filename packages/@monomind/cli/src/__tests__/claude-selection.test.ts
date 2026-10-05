import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { selectClaudePath, setOperatorClaudePath } from '../orgrt/claude-selection.js';

const homes: string[] = [];
afterEach(() => homes.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function home() {
  const p = mkdtempSync(join(tmpdir(), 'claude-selection-'));
  homes.push(p);
  return p;
}
it('selects flag > environment > operator config > automatic detection', () => {
  const h = home();
  expect(selectClaudePath({}, h)).toBeUndefined();
  setOperatorClaudePath('/config/claude', h);
  expect(selectClaudePath({}, h)).toEqual({ path: '/config/claude', source: 'config claude.path' });
  expect(selectClaudePath({ MONOMIND_CLAUDE_PATH: '/env/claude' }, h)).toEqual({
    path: '/env/claude',
    source: 'MONOMIND_CLAUDE_PATH',
  });
  expect(selectClaudePath({ MONOMIND_CLAUDE_PATH: '/env/claude' }, h, '/flag/claude')).toEqual({
    path: '/flag/claude',
    source: '--claude-path',
  });
});
it('writes only home config and rejects relative values', () => {
  const h = home();
  expect(() => setOperatorClaudePath('project/claude', h)).toThrow('absolute');
  setOperatorClaudePath('bundled', h);
  expect(JSON.parse(readFileSync(join(h, '.monomind', 'config.json'), 'utf8'))).toEqual({
    claude: { path: 'bundled' },
  });
  mkdirSync(join(h, 'project'));
  writeFileSync(
    join(h, 'project', 'monomind.config.json'),
    JSON.stringify({ claude: { path: '/evil/claude' } }),
  );
  expect(selectClaudePath({}, h)?.path).toBe('bundled');
});
it('rejects a home config redirected to a project file', async () => {
  const { symlinkSync } = await import('node:fs');
  const h = home();
  mkdirSync(join(h, '.monomind'));
  writeFileSync(join(h, 'project.json'), JSON.stringify({ claude: { path: '/project/claude' } }));
  symlinkSync(join(h, 'project.json'), join(h, '.monomind', 'config.json'));
  expect(() => selectClaudePath({}, h)).toThrow('symlink');
});
it('protects the configured binary and its parent directories for org roles', async () => {
  const { protectedClaudeBinary } = await import('../orgrt/claude-sdk.js');
  const h = home();
  const dir = join(h, 'bin');
  mkdirSync(dir);
  const binary = join(dir, 'claude');
  writeFileSync(binary, 'native test fixture');
  setOperatorClaudePath(binary, h);
  expect(protectedClaudeBinary({}, h)).toEqual({ file: binary, dirs: [dir] });
  expect(protectedClaudeBinary({ MONOMIND_CLAUDE_PATH: 'bundled' }, h)).toBeUndefined();
});
it('rejects a writable config directory even if the file itself is private', async () => {
  const { chmodSync } = await import('node:fs');
  const h = home();
  setOperatorClaudePath('/safe/claude', h);
  chmodSync(join(h, '.monomind'), 0o777);
  expect(() => selectClaudePath({}, h)).toThrow('directory');
  expect(() => setOperatorClaudePath('/other/claude', h)).toThrow('directory');
});
