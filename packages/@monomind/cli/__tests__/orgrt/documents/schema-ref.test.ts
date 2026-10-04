import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocError } from '../../../src/orgrt/documents/errors.js';
import { loadSchemaRef, resolveSchemaSource } from '../../../src/orgrt/documents/schema-ref.js';

let base: string;
let root: string;
let outside: string;
const schema = { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } };

beforeAll(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'docs-ref-'));
  root = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(join(root, 'schemas'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'schemas/ok.json'), JSON.stringify(schema));
  writeFileSync(join(outside, 'secret.json'), JSON.stringify(schema));
  writeFileSync(join(root, 'schemas/notjson.json'), '{ nope');
  writeFileSync(join(root, 'schemas/badkeyword.json'), JSON.stringify({ type: 'string', pattern: 'x' }));
  writeFileSync(join(root, 'schemas/huge.json'), JSON.stringify({ description: 'x'.repeat(300 * 1024) }));
  writeFileSync(join(root, 'schemas/data.txt'), '{}');
  symlinkSync(join(outside, 'secret.json'), join(root, 'schemas/escape.json'));
  symlinkSync(outside, join(root, 'linkdir'));
  symlinkSync(join(root, 'schemas/ok.json'), join(root, 'schemas/inside-link.json'));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DocError).code;
  }
  return 'NO_ERROR';
};

describe('loadSchemaRef', () => {
  it('loads a project file and snapshots its bytes, size and sha-256', () => {
    const snap = loadSchemaRef(root, 'schemas/ok.json');
    const bytes = Buffer.from(JSON.stringify(schema));
    expect(snap.schema).toEqual(schema);
    expect(snap.source).toEqual({
      path: 'schemas/ok.json',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('a symlink that stays inside the project is followed and reported by its real path', () => {
    expect(loadSchemaRef(root, 'schemas/inside-link.json').source?.path).toBe('schemas/ok.json');
  });

  it('refuses a path that leaves the project, by traversal, absolute path, symlink file or symlink directory', () => {
    expect(code(() => loadSchemaRef(root, '../outside/secret.json'))).toBe('SCHEMA_REF_ESCAPE');
    expect(code(() => loadSchemaRef(root, join(outside, 'secret.json')))).toBe('SCHEMA_REF_ESCAPE');
    expect(code(() => loadSchemaRef(root, 'schemas/escape.json'))).toBe('SCHEMA_REF_ESCAPE');
    expect(code(() => loadSchemaRef(root, 'linkdir/secret.json'))).toBe('SCHEMA_REF_ESCAPE');
    expect(code(() => loadSchemaRef(root, 'schemas/../../outside/secret.json'))).toBe('SCHEMA_REF_ESCAPE');
  });

  it('refuses malformed references, missing and non-regular files, bad JSON and bad schemas', () => {
    for (const bad of [undefined, null, 3, '', 'a\0.json', '#/x', 'http://x/y.json', 'file:///etc/x.json', 'schemas/data.txt'])
      expect(code(() => loadSchemaRef(root, bad))).toBe('SCHEMA_REF_INVALID');
    expect(code(() => loadSchemaRef(root, 'schemas/missing.json'))).toBe('SCHEMA_REF_UNREADABLE');
    expect(code(() => loadSchemaRef(join(base, 'no-such-root'), 'x.json'))).toBe('SCHEMA_REF_UNREADABLE');
    expect(code(() => loadSchemaRef(root, 'schemas/notjson.json'))).toBe('SCHEMA_REF_NOT_JSON');
    expect(code(() => loadSchemaRef(root, 'schemas/badkeyword.json'))).toBe('SCHEMA_UNSUPPORTED_KEYWORD');
    expect(code(() => loadSchemaRef(root, 'schemas/huge.json'))).toBe('SCHEMA_TOO_LARGE');
    mkdirSync(join(root, 'schemas/dir.json'));
    expect(code(() => loadSchemaRef(root, 'schemas/dir.json'))).toBe('SCHEMA_REF_UNREADABLE');
  });

  it('a later edit of the file does not change the snapshot already taken', () => {
    const snap = loadSchemaRef(root, 'schemas/ok.json');
    writeFileSync(join(root, 'schemas/ok.json'), JSON.stringify({ type: 'string' }));
    expect(snap.schema).toEqual(schema);
    expect(loadSchemaRef(root, 'schemas/ok.json').schema).toEqual({ type: 'string' });
    writeFileSync(join(root, 'schemas/ok.json'), JSON.stringify(schema));
  });
});

describe('resolveSchemaSource', () => {
  it('takes an inline schema (no source) or a lone $ref', () => {
    expect(resolveSchemaSource(schema, root)).toEqual({ schema, source: null });
    expect(resolveSchemaSource({ $ref: 'schemas/ok.json' }, root).source?.path).toBe('schemas/ok.json');
  });

  it('refuses a $ref next to other keywords, a non-string $ref, and a bad inline schema', () => {
    expect(code(() => resolveSchemaSource({ $ref: 'schemas/ok.json', type: 'object' }, root))).toBe('SCHEMA_REF_INVALID');
    expect(code(() => resolveSchemaSource({ $ref: 3 }, root))).toBe('SCHEMA_REF_INVALID');
    expect(code(() => resolveSchemaSource({ type: 'string', oneOf: [] }, root))).toBe('SCHEMA_UNSUPPORTED_KEYWORD');
    expect(code(() => resolveSchemaSource('schemas/ok.json', root))).toBe('SCHEMA_NOT_OBJECT');
  });

  it('a $ref inside a loaded file is a nested reference and is refused', () => {
    writeFileSync(join(root, 'schemas/nested.json'), JSON.stringify({ properties: { a: { $ref: 'other.json' } } }));
    expect(code(() => loadSchemaRef(root, 'schemas/nested.json'))).toBe('SCHEMA_UNSUPPORTED_KEYWORD');
  });
});
