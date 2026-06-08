import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installGitHooks, uninstallGitHooks, listInstalledHooks } from '../../cli/hooks-install.js';
describe('installGitHooks', () => {
    let tmpDir;
    let hooksDir;
    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'hooks-test-'));
        hooksDir = join(tmpDir, '.git', 'hooks');
        mkdirSync(hooksDir, { recursive: true });
    });
    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
    it('creates pre-commit hook with monograph build command', () => {
        installGitHooks(tmpDir, ['pre-commit']);
        const hookPath = join(hooksDir, 'pre-commit');
        expect(existsSync(hookPath)).toBe(true);
        const content = readFileSync(hookPath, 'utf8');
        expect(content).toContain('monograph');
        expect(content).toContain('#!/');
    });
    it('creates post-merge hook', () => {
        installGitHooks(tmpDir, ['post-merge']);
        expect(existsSync(join(hooksDir, 'post-merge'))).toBe(true);
    });
    it('creates both hooks when both specified', () => {
        installGitHooks(tmpDir, ['pre-commit', 'post-merge']);
        expect(existsSync(join(hooksDir, 'pre-commit'))).toBe(true);
        expect(existsSync(join(hooksDir, 'post-merge'))).toBe(true);
    });
    it('throws when .git directory does not exist', () => {
        expect(() => installGitHooks('/nonexistent/repo', ['pre-commit'])).toThrow();
    });
    it('lists installed hooks', () => {
        installGitHooks(tmpDir, ['pre-commit']);
        const installed = listInstalledHooks(tmpDir);
        expect(installed).toContain('pre-commit');
    });
    it('uninstalls a hook', () => {
        installGitHooks(tmpDir, ['pre-commit']);
        uninstallGitHooks(tmpDir, ['pre-commit']);
        expect(existsSync(join(hooksDir, 'pre-commit'))).toBe(false);
    });
});
//# sourceMappingURL=hooks-install.test.js.map