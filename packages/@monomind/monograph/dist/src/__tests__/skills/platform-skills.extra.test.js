import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installPlatformSkill, SUPPORTED_PLATFORMS } from '../../skills/platform-skills.js';
describe('additional platform skills', () => {
    let tmpDir;
    beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'skills-extra-')); });
    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });
    it('SUPPORTED_PLATFORMS includes codex, gemini, aider, copilot, kiro', () => {
        expect(SUPPORTED_PLATFORMS).toContain('codex');
        expect(SUPPORTED_PLATFORMS).toContain('gemini');
        expect(SUPPORTED_PLATFORMS).toContain('aider');
        expect(SUPPORTED_PLATFORMS).toContain('copilot');
        expect(SUPPORTED_PLATFORMS).toContain('kiro');
    });
    it('installs codex skill file', () => {
        const result = installPlatformSkill(tmpDir, 'codex', []);
        expect(result.filesWritten.length).toBeGreaterThan(0);
        expect(result.filesWritten.some(f => existsSync(f))).toBe(true);
    });
    it('installs gemini skill file', () => {
        const result = installPlatformSkill(tmpDir, 'gemini', []);
        expect(result.filesWritten.length).toBeGreaterThan(0);
    });
    it('installs kiro skill file', () => {
        const result = installPlatformSkill(tmpDir, 'kiro', []);
        expect(result.filesWritten.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=platform-skills.extra.test.js.map