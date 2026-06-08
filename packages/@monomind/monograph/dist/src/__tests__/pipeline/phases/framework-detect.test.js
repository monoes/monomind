import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectFrameworks } from '../../../pipeline/phases/framework-detect.js';
describe('detectFrameworks', () => {
    let tmpDir;
    beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'fw-detect-')); });
    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });
    it('detects React from package.json dependencies', () => {
        writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
            dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        }));
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toContain('react');
        expect(result.primaryLanguage).toBe('javascript');
    });
    it('detects Express from package.json', () => {
        writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
            dependencies: { express: '^4.18.0' },
        }));
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toContain('express');
    });
    it('detects Django from requirements.txt', () => {
        writeFileSync(join(tmpDir, 'requirements.txt'), 'Django==4.2\npsycopg2-binary\n');
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toContain('django');
        expect(result.primaryLanguage).toBe('python');
    });
    it('detects Spring from pom.xml', () => {
        writeFileSync(join(tmpDir, 'pom.xml'), '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>');
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toContain('spring');
        expect(result.primaryLanguage).toBe('java');
    });
    it('detects Vue from package.json', () => {
        writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.0.0' } }));
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toContain('vue');
    });
    it('returns empty arrays when no framework files exist', () => {
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toEqual([]);
        expect(result.primaryLanguage).toBeNull();
    });
    it('detects multiple frameworks', () => {
        writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
            dependencies: { react: '^18', express: '^4' },
        }));
        const result = detectFrameworks(tmpDir);
        expect(result.frameworks).toContain('react');
        expect(result.frameworks).toContain('express');
    });
});
//# sourceMappingURL=framework-detect.test.js.map