import { describe, expect, it } from 'vitest';
import { VERSION } from '../index.js';
import { generatePostCommitHook } from '../init/helpers-core-scripts.js';
import { clineInstallCommand, clineRule } from '../init/write-cline.js';

describe('init pins every executed monomind command (#419)', () => {
  it('post-commit hook pins to the installed version by default', () => {
    const s = generatePostCommitHook();
    expect(s).toContain(`--package=@monoes/monomindcli@${VERSION} monomind hooks notify`);
    expect(s).not.toContain('monomind@latest');
  });
  it('--pin latest keeps the hook floating, a version pins to it', () => {
    expect(generatePostCommitHook('latest')).toContain('npx -y monomind@latest hooks notify');
    expect(generatePostCommitHook('1.2.3')).toContain('monomindcli@1.2.3 monomind hooks notify');
  });
  it('cline install command and rule are pinned unless latest', () => {
    expect(clineInstallCommand()).toContain(`monomindcli@${VERSION} monomind mcp start`);
    expect(clineRule()).not.toContain('monomind@latest');
    expect(clineInstallCommand('latest')).toContain('npx -y monomind@latest mcp start');
    expect(clineRule('latest')).toContain('monomind@latest');
  });
});
