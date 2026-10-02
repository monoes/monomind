import { describe, expect, it } from 'vitest';
import { assertSupportedSchema, checkAgainstSchema } from './schema.js';

const brief = {
  type: 'object',
  required: ['title', 'claims'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 20 },
    claims: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
    kind: { enum: ['post', 'thread'] },
    score: { type: 'integer', minimum: 0, maximum: 10 },
  },
};

describe('the pilot document schema dialect', () => {
  it('accepts a conforming document', () => {
    expect(
      checkAgainstSchema(brief, { title: 'Hello', claims: ['a'], kind: 'post', score: 3 }),
    ).toEqual([]);
  });

  it('names every problem with its path', () => {
    const problems = checkAgainstSchema(brief, {
      title: 'x',
      claims: [],
      kind: 'essay',
      score: 11,
      extra: 1,
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        '$.title: shorter than 3 characters',
        '$.claims: fewer than 1 items',
        '$.kind: not one of "post", "thread"',
        '$.score: above 10',
        '$.extra: not allowed',
      ]),
    );
  });

  it('reports a missing required field and a wrong type', () => {
    expect(checkAgainstSchema(brief, { claims: 'no' })).toEqual(
      expect.arrayContaining(['$.title: required', '$.claims: expected array, got string']),
    );
  });

  it('tells integer from number and rejects a non-object root', () => {
    expect(checkAgainstSchema({ type: 'integer' }, 1.5)).toEqual([
      '$: expected integer, got number',
    ]);
    expect(checkAgainstSchema({ type: 'object' }, [])).toEqual(['$: expected object, got array']);
    expect(checkAgainstSchema({ type: 'string' }, null)).toEqual(['$: expected string, got null']);
  });

  it('refuses a schema using a keyword outside the dialect, rather than ignoring it', () => {
    expect(() => assertSupportedSchema({ type: 'string', pattern: '^a' })).toThrow(
      /\$\.pattern.*not supported/,
    );
    expect(() =>
      assertSupportedSchema({ type: 'object', properties: { a: { $ref: '#/x' } } }),
    ).toThrow(/\$\.properties\.a\.\$ref/);
    expect(() => assertSupportedSchema({ oneOf: [] })).toThrow(/oneOf/);
  });

  it('accepts additionalProperties only as a boolean', () => {
    expect(() =>
      assertSupportedSchema({ type: 'object', additionalProperties: { type: 'string' } }),
    ).toThrow(/additionalProperties/);
    expect(() => assertSupportedSchema(brief)).not.toThrow();
  });
});
