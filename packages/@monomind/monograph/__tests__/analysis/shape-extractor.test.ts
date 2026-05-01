import { describe, it, expect } from 'vitest';
import {
  extractHandlerReturnKeys,
  extractAccessedKeys,
  compareShapes,
} from '../../src/analysis/shape-extractor.js';

describe('extractHandlerReturnKeys', () => {
  it('extracts keys from .json({ id, name })', () => {
    const src = `res.json({ id: user.id, name: user.name })`;
    expect(extractHandlerReturnKeys(src)).toEqual(['id', 'name']);
  });

  it('extracts keys from return { status, data } sorted alphabetically', () => {
    const src = `return { status: 'ok', data: [] }`;
    expect(extractHandlerReturnKeys(src)).toEqual(['data', 'status']);
  });

  it('extracts keys from NextResponse.json({ key })', () => {
    const src = `return NextResponse.json({ success: true, token: jwt })`;
    expect(extractHandlerReturnKeys(src)).toEqual(['success', 'token']);
  });

  it('returns empty array when no pattern is found', () => {
    const src = `const x = 1; console.log(x);`;
    expect(extractHandlerReturnKeys(src)).toEqual([]);
  });

  it('deduplicates keys across multiple occurrences', () => {
    const src = `
      if (error) return res.json({ message: 'fail' });
      return res.json({ message: 'ok', id: 1 });
    `;
    expect(extractHandlerReturnKeys(src)).toEqual(['id', 'message']);
  });

  it('ignores spread properties', () => {
    const src = `res.json({ ...user, extra: true })`;
    const keys = extractHandlerReturnKeys(src);
    expect(keys).toContain('extra');
    expect(keys).not.toContain('...user');
  });
});

describe('extractAccessedKeys', () => {
  it('extracts dot-access keys from response variable', () => {
    const src = `const email = data.email;`;
    expect(extractAccessedKeys(src, ['data'])).toContain('email');
  });

  it('extracts destructured keys from response variable', () => {
    const src = `const { id, name } = result;`;
    expect(extractAccessedKeys(src, ['result'])).toEqual(
      expect.arrayContaining(['id', 'name']),
    );
  });

  it('extracts keys from both dot-access and destructuring', () => {
    const src = `
      const { id, name } = result;
      console.log(data.email);
    `;
    const keys = extractAccessedKeys(src, ['data', 'result']);
    expect(keys).toEqual(expect.arrayContaining(['email', 'id', 'name']));
  });

  it('excludes method calls (data.json() should not add json)', () => {
    const src = `data.json().then(r => r)`;
    const keys = extractAccessedKeys(src, ['data']);
    expect(keys).not.toContain('json');
  });

  it('returns sorted unique keys', () => {
    const src = `
      const z = data.z;
      const a = data.a;
      const z2 = data.z;
    `;
    const keys = extractAccessedKeys(src, ['data']);
    expect(keys).toEqual(['a', 'z']);
  });

  it('uses default var names when not provided', () => {
    const src = `const x = response.userId;`;
    const keys = extractAccessedKeys(src);
    expect(keys).toContain('userId');
  });
});

describe('compareShapes', () => {
  it('returns MATCH when all accessed keys are returned', () => {
    const shape = compareShapes(['id', 'name', 'email'], ['id', 'name']);
    expect(shape.status).toBe('MATCH');
    expect(shape.mismatches).toHaveLength(0);
    expect(shape.extra).toEqual(['email']);
  });

  it('returns MISMATCH when an accessed key is not returned', () => {
    const shape = compareShapes(['id', 'name'], ['id', 'name', 'token']);
    expect(shape.status).toBe('MISMATCH');
    expect(shape.mismatches).toEqual(['token']);
  });

  it('returns UNKNOWN when returnedKeys is empty', () => {
    const shape = compareShapes([], ['id']);
    expect(shape.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when accessedKeys is empty', () => {
    const shape = compareShapes(['id', 'name'], []);
    expect(shape.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when both sets are empty', () => {
    const shape = compareShapes([], []);
    expect(shape.status).toBe('UNKNOWN');
  });

  it('populates returnedKeys and accessedKeys on result', () => {
    const shape = compareShapes(['id'], ['id']);
    expect(shape.returnedKeys).toEqual(['id']);
    expect(shape.accessedKeys).toEqual(['id']);
  });
});
