import { describe, it, expect } from 'vitest';
import { extractFieldAccesses } from '../../../src/pipeline/phases/field-access.js';

describe('extractFieldAccesses', () => {
  it('detects property reads', () => {
    const src = `function greet(user: User) { return user.name; }`;
    const accesses = extractFieldAccesses(src, 'user', 'src/a.ts');
    expect(accesses.some(a => a.field === 'name' && a.reason === 'read')).toBe(true);
  });

  it('detects property writes', () => {
    const src = `function update(obj: Obj) { obj.count = 1; obj.total += 5; }`;
    const accesses = extractFieldAccesses(src, 'obj', 'src/a.ts');
    expect(accesses.some(a => a.field === 'count' && a.reason === 'write')).toBe(true);
    expect(accesses.some(a => a.field === 'total' && a.reason === 'write')).toBe(true);
  });

  it('returns empty when no accesses found', () => {
    const src = `function noop() { return 42; }`;
    expect(extractFieldAccesses(src, 'obj', 'src/a.ts')).toHaveLength(0);
  });
});
