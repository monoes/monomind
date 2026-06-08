import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileContent } from '../../web/api.js';
describe('readFileContent', () => {
    let tmpDir;
    let filePath;
    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'api-file-test-'));
        filePath = join(tmpDir, 'sample.ts');
        writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5\n');
    });
    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
    it('returns full file content with lines', () => {
        const result = readFileContent(filePath);
        expect(result.lines.length).toBe(5);
        expect(result.lines[0]).toEqual({ number: 1, content: 'line1' });
        expect(result.lines[4]).toEqual({ number: 5, content: 'line5' });
    });
    it('returns a slice when startLine and endLine provided', () => {
        const result = readFileContent(filePath, 2, 4);
        expect(result.lines.length).toBe(3);
        expect(result.lines[0]).toEqual({ number: 2, content: 'line2' });
        expect(result.lines[2]).toEqual({ number: 4, content: 'line4' });
    });
    it('throws for non-existent file', () => {
        expect(() => readFileContent('/nonexistent/path.ts')).toThrow();
    });
    it('result has totalLines field', () => {
        const result = readFileContent(filePath);
        expect(result.totalLines).toBe(5);
        expect(result.path).toBe(filePath);
    });
});
//# sourceMappingURL=api.file.test.js.map