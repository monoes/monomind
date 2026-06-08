import { describe, it, expect } from 'vitest';
import { extractGoCallSites } from '../../../pipeline/phases/scope-resolution.js';
describe('extractGoCallSites', () => {
    it('extracts method calls (receiver.Method)', () => {
        const source = `
func run(s *Server) {
  s.Listen(":8080")
  db.Query("SELECT 1")
}`;
        const sites = extractGoCallSites(source, '/app/main.go', 'fn1');
        expect(sites.some(s => s.calleeRaw === 's.Listen')).toBe(true);
        expect(sites.some(s => s.calleeRaw === 'db.Query')).toBe(true);
    });
    it('extracts direct function calls', () => {
        const source = `
func init() {
  setupRoutes()
  fmt.Println("started")
}`;
        const sites = extractGoCallSites(source, '/app/main.go', 'fn1');
        expect(sites.some(s => s.calleeRaw === 'setupRoutes')).toBe(true);
    });
    it('skips Go keywords', () => {
        const source = `for i := range items { if ok { return } }`;
        const sites = extractGoCallSites(source, '/app/main.go', 'fn1');
        const names = sites.map(s => s.calleeRaw);
        expect(names).not.toContain('for');
        expect(names).not.toContain('if');
        expect(names).not.toContain('return');
    });
});
//# sourceMappingURL=scope-resolution.go.test.js.map