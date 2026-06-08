import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanPhase } from '../../../pipeline/phases/scan.js';
function makeCtx(repoPath) {
    return { repoPath, options: { ignore: [], codeOnly: false }, onProgress: undefined };
}
describe('scanPhase .monographignore negation', () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'scan-neg-test-'));
        mkdirSync(join(tmpDir, 'generated'));
        writeFileSync(join(tmpDir, 'generated', 'schema.ts'), 'export type T = string;');
        writeFileSync(join(tmpDir, 'generated', 'keep-this.ts'), 'export type K = number;');
        writeFileSync(join(tmpDir, 'app.ts'), 'export const x = 1;');
    });
    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
    it('negation pattern !file preserves file even when parent dir is ignored', async () => {
        // Ignore all generated/ but keep keep-this.ts via negation
        writeFileSync(join(tmpDir, '.monographignore'), 'generated/\n!generated/keep-this.ts\n');
        const out = await scanPhase.execute(makeCtx(tmpDir), new Map());
        const names = out.filePaths.map((p) => p.replace(tmpDir, ''));
        expect(names.some((n) => n.includes('keep-this.ts'))).toBe(true);
        expect(names.some((n) => n.includes('schema.ts'))).toBe(false);
    });
    it('negation without prior ignore is a no-op (file already included)', async () => {
        writeFileSync(join(tmpDir, '.monographignore'), '!app.ts\n');
        const out = await scanPhase.execute(makeCtx(tmpDir), new Map());
        expect(out.filePaths.some((p) => p.includes('app.ts'))).toBe(true);
    });
});
//# sourceMappingURL=scan.negation.test.js.map