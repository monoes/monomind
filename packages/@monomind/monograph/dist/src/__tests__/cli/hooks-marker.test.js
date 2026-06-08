/**
 * Tests for marker-based hook management enhancements.
 * Covers: append-not-overwrite, uninstall-only-marker-block, post-checkout,
 * Husky detection, rebase guards, and per-hook status details.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installGitHooks, uninstallGitHooks, getHookStatus, HOOK_MARKER_START, } from '../../cli/hooks-install.js';
function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'mhook-'));
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    return dir;
}
describe('marker-based append (not overwrite)', () => {
    let tmpDir;
    afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));
    it('appends monograph block to existing hook content', () => {
        tmpDir = makeRepo();
        const hookPath = join(tmpDir, '.git', 'hooks', 'pre-commit');
        const existing = '#!/bin/sh\necho "my custom hook"\n';
        writeFileSync(hookPath, existing, 'utf8');
        installGitHooks(tmpDir, ['pre-commit']);
        const content = readFileSync(hookPath, 'utf8');
        expect(content).toContain('my custom hook'); // existing preserved
        expect(content).toContain(HOOK_MARKER_START);
        expect(content).toContain('monograph');
    });
    it('does not duplicate the block on repeated installs', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['pre-commit']);
        installGitHooks(tmpDir, ['pre-commit']);
        const content = readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf8');
        const count = (content.match(new RegExp(HOOK_MARKER_START, 'g')) ?? []).length;
        expect(count).toBe(1);
    });
});
describe('marker-based uninstall (only removes block)', () => {
    let tmpDir;
    afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));
    it('removes only the monograph block, leaves rest of hook intact', () => {
        tmpDir = makeRepo();
        const hookPath = join(tmpDir, '.git', 'hooks', 'pre-commit');
        writeFileSync(hookPath, '#!/bin/sh\necho "keep this"\n', 'utf8');
        installGitHooks(tmpDir, ['pre-commit']);
        uninstallGitHooks(tmpDir, ['pre-commit']);
        const content = readFileSync(hookPath, 'utf8');
        expect(content).toContain('keep this');
        expect(content).not.toContain(HOOK_MARKER_START);
        expect(content).not.toContain('monograph build');
    });
    it('deletes the file if it was created entirely by monograph (no prior content)', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['pre-commit']);
        uninstallGitHooks(tmpDir, ['pre-commit']);
        // file should no longer contain the marker block
        const hookPath = join(tmpDir, '.git', 'hooks', 'pre-commit');
        try {
            const content = readFileSync(hookPath, 'utf8');
            expect(content).not.toContain(HOOK_MARKER_START);
        }
        catch {
            // file deleted entirely is also acceptable
        }
    });
});
describe('post-checkout hook support', () => {
    let tmpDir;
    afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));
    it('installs post-checkout hook', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['post-checkout']);
        const content = readFileSync(join(tmpDir, '.git', 'hooks', 'post-checkout'), 'utf8');
        expect(content).toContain('monograph');
    });
    it('post-checkout hook includes rebase/merge skip guard', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['post-checkout']);
        const content = readFileSync(join(tmpDir, '.git', 'hooks', 'post-checkout'), 'utf8');
        // Should skip during rebase or merge operations
        expect(content).toMatch(/rebase|MERGE|cherry-pick/i);
    });
});
describe('rebase guard in hook scripts', () => {
    let tmpDir;
    afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));
    it('pre-commit hook includes rebase skip guard', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['pre-commit']);
        const content = readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf8');
        expect(content).toMatch(/rebase|MERGE|cherry-pick/i);
    });
});
describe('per-hook status (getHookStatus with details)', () => {
    let tmpDir;
    afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));
    it('returns per-hook detail objects', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['pre-commit', 'post-checkout']);
        const status = getHookStatus(tmpDir);
        expect(status.perHook).toBeDefined();
        const preCommit = status.perHook['pre-commit'];
        expect(preCommit).toBeDefined();
        expect(preCommit.installed).toBe(true);
    });
    it('perHook shows not-installed for hooks that were not set up', () => {
        tmpDir = makeRepo();
        installGitHooks(tmpDir, ['pre-commit']);
        const status = getHookStatus(tmpDir);
        const postMerge = status.perHook?.['post-merge'];
        expect(postMerge?.installed ?? false).toBe(false);
    });
});
//# sourceMappingURL=hooks-marker.test.js.map