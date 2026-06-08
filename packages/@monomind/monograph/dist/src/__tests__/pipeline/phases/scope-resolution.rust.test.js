import { describe, it, expect } from 'vitest';
import { extractRustCallSites } from '../../../pipeline/phases/scope-resolution.js';
describe('extractRustCallSites', () => {
    it('extracts method calls', () => {
        const source = `
fn main() {
  server.run();
  db.connect("sqlite::memory:");
}`;
        const sites = extractRustCallSites(source, '/src/main.rs', 'fn1');
        expect(sites.some(s => s.calleeRaw === 'server.run')).toBe(true);
        expect(sites.some(s => s.calleeRaw === 'db.connect')).toBe(true);
    });
    it('extracts direct function calls', () => {
        const source = `fn setup() { init_logging(); register_handlers(); }`;
        const sites = extractRustCallSites(source, '/src/main.rs', 'fn1');
        expect(sites.some(s => s.calleeRaw === 'init_logging')).toBe(true);
        expect(sites.some(s => s.calleeRaw === 'register_handlers')).toBe(true);
    });
    it('skips Rust keywords', () => {
        const source = `if let Some(x) = val { for item in list { return Ok(()); } }`;
        const sites = extractRustCallSites(source, '/src/main.rs', 'fn1');
        const names = sites.map(s => s.calleeRaw);
        expect(names).not.toContain('if');
        expect(names).not.toContain('for');
        expect(names).not.toContain('return');
    });
});
//# sourceMappingURL=scope-resolution.rust.test.js.map