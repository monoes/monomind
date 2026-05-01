import { describe, it, expect } from 'vitest';
import { extractJavaCallSites } from '../../../pipeline/phases/scope-resolution.js';

describe('extractJavaCallSites', () => {
  it('extracts method calls', () => {
    const source = `
public void run() {
  service.process(request);
  logger.info("done");
}`;
    const sites = extractJavaCallSites(source, '/src/Main.java', 'fn1');
    expect(sites.some(s => s.calleeRaw === 'service.process')).toBe(true);
    expect(sites.some(s => s.calleeRaw === 'logger.info')).toBe(true);
  });

  it('extracts direct function calls', () => {
    const source = `Objects.requireNonNull(val);`;
    const sites = extractJavaCallSites(source, '/src/Main.java', 'fn1');
    expect(sites.length).toBeGreaterThan(0);
  });

  it('skips Java keywords', () => {
    const source = `if (x) { for (int i = 0; i < 10; i++) { return; } }`;
    const sites = extractJavaCallSites(source, '/src/Main.java', 'fn1');
    const names = sites.map(s => s.calleeRaw);
    expect(names).not.toContain('if');
    expect(names).not.toContain('for');
    expect(names).not.toContain('return');
  });
});
