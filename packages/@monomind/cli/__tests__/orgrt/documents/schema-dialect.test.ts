import { describe, expect, it } from 'vitest';
import { DocError, type DocErrorCode } from '../../../src/orgrt/documents/errors.js';
import {
  assertSupportedSchema,
  checkAgainstSchema,
  validateSchema,
  validateValue,
} from '../../../src/orgrt/documents/schema-dialect.js';

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

const codes = (schema: unknown) => validateSchema(schema).map((p) => `${p.code}@${p.path}`);

describe('org-schema-v1: values (ported prototype cases)', () => {
  it('accepts a conforming document', () => {
    expect(checkAgainstSchema(brief, { title: 'Hello', claims: ['a'], kind: 'post', score: 3 })).toEqual([]);
  });

  it('names every problem with its path', () => {
    expect(
      checkAgainstSchema(brief, { title: 'x', claims: [], kind: 'essay', score: 11, extra: 1 }),
    ).toEqual(
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

  it('tells integer from number and rejects wrong roots', () => {
    expect(checkAgainstSchema({ type: 'integer' }, 1.5)).toEqual(['$: expected integer, got number']);
    expect(checkAgainstSchema({ type: 'integer' }, 2)).toEqual([]);
    expect(checkAgainstSchema({ type: 'number' }, 1.5)).toEqual([]);
    expect(checkAgainstSchema({ type: 'object' }, [])).toEqual(['$: expected object, got array']);
    expect(checkAgainstSchema({ type: 'string' }, null)).toEqual(['$: expected string, got null']);
    expect(checkAgainstSchema({ type: 'null' }, null)).toEqual([]);
    expect(checkAgainstSchema({ type: 'boolean' }, 'true')).toEqual(['$: expected boolean, got string']);
  });
});

describe('org-schema-v1: every allowed keyword has a passing and a failing fixture', () => {
  const table: [string, object, unknown, unknown, string][] = [
    ['type', { type: 'string' }, 'a', 1, 'VALUE_TYPE'],
    ['enum (objects too)', { enum: [{ a: [1] }, 'x'] }, { a: [1] }, { a: [2] }, 'VALUE_ENUM'],
    ['const', { const: { k: 1 } }, { k: 1 }, { k: 2 }, 'VALUE_CONST'],
    ['const null', { const: null }, null, 0, 'VALUE_CONST'],
    ['properties', { properties: { a: { type: 'integer' } } }, { a: 1 }, { a: 'x' }, 'VALUE_TYPE'],
    ['required', { required: ['a'] }, { a: 1 }, {}, 'VALUE_REQUIRED'],
    ['additionalProperties false', { additionalProperties: false }, {}, { z: 1 }, 'VALUE_NOT_ALLOWED'],
    ['additionalProperties schema', { additionalProperties: { type: 'integer' } }, { z: 1 }, { z: 'x' }, 'VALUE_TYPE'],
    ['items', { items: { type: 'integer' } }, [1, 2], [1, 'x'], 'VALUE_TYPE'],
    ['minLength', { minLength: 2 }, 'ab', 'a', 'VALUE_TOO_SHORT'],
    ['maxLength', { maxLength: 2 }, 'ab', 'abc', 'VALUE_TOO_LONG'],
    ['minimum', { minimum: 1 }, 1, 0, 'VALUE_BELOW_MINIMUM'],
    ['maximum', { maximum: 1 }, 1, 2, 'VALUE_ABOVE_MAXIMUM'],
    ['minItems', { minItems: 1 }, [0], [], 'VALUE_TOO_FEW_ITEMS'],
    ['maxItems', { maxItems: 1 }, [0], [0, 0], 'VALUE_TOO_MANY_ITEMS'],
  ];
  for (const [name, schema, good, badValue, code] of table)
    it(name, () => {
      expect(validateSchema(schema)).toEqual([]);
      expect(validateValue(schema, good)).toEqual([]);
      expect(validateValue(schema, badValue).map((p) => p.code)).toContain(code);
    });

  it('keywords only constrain the types they apply to (JSON Schema semantics)', () => {
    expect(validateValue({ minLength: 5, minimum: 5, minItems: 5, required: ['a'] }, 'abcdef')).toEqual([]);
    expect(validateValue({ minLength: 5 }, 12)).toEqual([]);
    expect(validateValue({ required: ['a'] }, [1])).toEqual([]);
  });

  it('counts string length in characters (code points), not UTF-16 units', () => {
    expect(validateValue({ maxLength: 1 }, '😀')).toEqual([]);
    expect(validateValue({ minLength: 2 }, '😀')).toHaveLength(1);
    expect(validateValue({ maxLength: 2 }, 'é́')).toHaveLength(0);
  });

  it('integer is a number with no fraction; 1.0 is an integer; huge and negative zero behave', () => {
    expect(validateValue({ type: 'integer' }, 1.0)).toEqual([]);
    expect(validateValue({ type: 'integer' }, -0)).toEqual([]);
    expect(validateValue({ type: 'integer' }, 1e300)).toEqual([]);
    expect(validateValue({ type: 'integer' }, 0.5)).toHaveLength(1);
  });

  it('does not mistake inherited names for properties or required members', () => {
    expect(validateValue({ required: ['toString'] }, {})).toEqual([
      expect.objectContaining({ code: 'VALUE_REQUIRED', path: '$.toString' }),
    ]);
    const s = { additionalProperties: false, properties: { a: { type: 'integer' } } };
    expect(validateValue(s, JSON.parse('{"constructor": 1}')).map((p) => p.code)).toEqual(['VALUE_NOT_ALLOWED']);
    expect(validateValue({ properties: { a: {} } }, JSON.parse('{"__proto__": {"x": 1}, "a": 1}'))).toEqual([]);
  });

  it('a value that is not JSON data is refused as a whole', () => {
    for (const v of [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 1, new Date(), { a: undefined }, 1n]) {
      expect(validateValue({}, v)).toEqual([expect.objectContaining({ code: 'VALUE_NOT_JSON', path: '$' })]);
    }
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(validateValue({}, cyc).map((p) => p.code)).toEqual(['VALUE_NOT_JSON']);
  });

  it('precise paths for nested and oddly named members', () => {
    const s = {
      properties: {
        a: { type: 'array', items: { properties: { 'b c': { type: 'integer' } } } },
      },
    };
    expect(checkAgainstSchema(s, { a: [{}, { 'b c': 'x' }] })).toEqual(['$.a[1]["b c"]: expected integer, got string']);
  });
});

describe('org-schema-v1: the schema is fail-closed', () => {
  it('accepts annotations and the prototype brief schema', () => {
    expect(validateSchema(brief)).toEqual([]);
    expect(
      validateSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 't',
        description: 'd',
        examples: [{ any: ['json', 1] }],
        type: 'object',
      }),
    ).toEqual([]);
  });

  const unsupported = [
    'pattern', 'format', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum', 'minProperties',
    'maxProperties', 'uniqueItems', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', '$ref',
    '$defs', 'definitions', '$id', '$anchor', '$dynamicRef', '$comment', 'patternProperties',
    'propertyNames', 'prefixItems', 'contains', 'dependentRequired', 'dependentSchemas',
    'unevaluatedProperties', 'unevaluatedItems', 'default', 'readOnly', 'writeOnly', 'deprecated',
    'nullable', 'x-anything', '',
  ];
  for (const k of unsupported)
    it(`refuses ${JSON.stringify(k)} with its path and a remedy, at the root and nested`, () => {
      const root = validateSchema({ type: 'object', [k]: 1 });
      expect(root).toEqual([expect.objectContaining({ code: 'SCHEMA_UNSUPPORTED_KEYWORD', path: k ? `$.${k}` : '$[""]' })]);
      expect(root[0].remedy).toBeTruthy();
      const nested = validateSchema({ properties: { a: { items: { additionalProperties: { [k]: 1 } } } } });
      expect(nested.map((p) => p.code)).toEqual(['SCHEMA_UNSUPPORTED_KEYWORD']);
      expect(nested[0].path).toBe(`$.properties.a.items.additionalProperties${k ? `.${k}` : '[""]'}`);
    });

  it('property names and data are not keywords', () => {
    expect(
      validateSchema({
        properties: { pattern: { type: 'string' }, $ref: { type: 'string' }, oneOf: {} },
        enum: [{ pattern: 1, $ref: 2 }],
        const: { oneOf: [] },
        examples: [{ not: 1 }],
      }),
    ).toEqual([]);
  });

  it('refuses unsupported forms of supported keywords', () => {
    expect(codes({ type: 'strng' })).toEqual(['SCHEMA_UNKNOWN_TYPE@$.type']);
    expect(codes({ type: ['string', 'null'] })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.type']);
    expect(codes({ type: 3 })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.type']);
    expect(codes({ items: [{}, {}] })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.items']);
    expect(codes({ items: true })).toEqual(['SCHEMA_NOT_OBJECT@$.items']);
    expect(codes({ properties: { a: true } })).toEqual(['SCHEMA_NOT_OBJECT@$.properties.a']);
    expect(codes({ properties: [] })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.properties']);
    expect(codes({ enum: [] })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.enum']);
    expect(codes({ enum: 'a' })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.enum']);
    expect(codes({ required: 'a' })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.required']);
    expect(codes({ required: ['a', 'a'] })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.required']);
    expect(codes({ required: [1] })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.required']);
    expect(codes({ additionalProperties: 'no' })).toEqual(['SCHEMA_NOT_OBJECT@$.additionalProperties']);
    expect(codes({ additionalProperties: { pattern: 'x' } })).toEqual([
      'SCHEMA_UNSUPPORTED_KEYWORD@$.additionalProperties.pattern',
    ]);
    for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems'])
      for (const bad of [-1, 1.5, '1', null, Number.NaN])
        expect(codes({ [k]: bad })).toEqual([`SCHEMA_INVALID_KEYWORD_VALUE@$.${k}`]);
    for (const k of ['minimum', 'maximum'])
      for (const bad of ['1', null, Number.POSITIVE_INFINITY, true])
        expect(codes({ [k]: bad }).length).toBeGreaterThan(0);
    expect(codes({ $schema: 'http://json-schema.org/draft-07/schema#' })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.$schema']);
    expect(codes({ title: 1 })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.title']);
    expect(codes({ description: {} })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.description']);
    expect(codes({ examples: 'x' })).toEqual(['SCHEMA_INVALID_KEYWORD_VALUE@$.examples']);
  });

  it('refuses a schema that is not an object, and data that is not JSON', () => {
    for (const s of [null, undefined, 3, 'x', [], true])
      expect(validateSchema(s).map((p) => p.code)).toEqual(['SCHEMA_NOT_OBJECT']);
    expect(codes({ const: undefined })).toEqual(['SCHEMA_NOT_JSON@$.const']);
    expect(codes({ enum: [Number.NaN] }).length).toBe(1);
    const cyc: Record<string, unknown> = {};
    cyc.properties = { a: cyc };
    expect(validateSchema(cyc).map((p) => p.code)).toEqual(['SCHEMA_NOT_JSON']);
  });

  it('reports every problem at once, not the first', () => {
    const p = validateSchema({ pattern: 'a', properties: { b: { oneOf: [] }, c: { type: 'x' } } });
    expect(p.map((x) => x.path)).toEqual(['$.pattern', '$.properties.b.oneOf', '$.properties.c.type']);
  });

  it('bounds nesting at 32 levels and size at 256 KiB', () => {
    const nest = (n: number) => {
      let s: Record<string, unknown> = { type: 'string' };
      for (let i = 1; i < n; i++) s = { items: s };
      return s;
    };
    expect(validateSchema(nest(32))).toEqual([]);
    expect(validateSchema(nest(33)).map((p) => p.code)).toEqual(['SCHEMA_TOO_DEEP']);
    expect(validateSchema(nest(5000)).length).toBeGreaterThan(0);
    const big = (n: number) => ({ description: 'x'.repeat(n) });
    expect(validateSchema(big(256 * 1024 - 20))).toEqual([]);
    expect(validateSchema(big(256 * 1024)).map((p) => p.code)).toEqual(['SCHEMA_TOO_LARGE']);
  });

  it('assertSupportedSchema throws a typed error naming code, path and remedy', () => {
    try {
      assertSupportedSchema({ type: 'string', pattern: '^a' });
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DocError);
      const err = e as DocError;
      expect(err.code).toBe('SCHEMA_UNSUPPORTED_KEYWORD' satisfies DocErrorCode);
      expect(err.message).toMatch(/\$\.pattern: keyword not supported by org-schema-v1 \(use enum/);
      expect(err.problems).toHaveLength(1);
    }
    expect(() => assertSupportedSchema(brief)).not.toThrow();
  });
});

describe('org-schema-v1: constructive property test (seeded)', () => {
  // Builds a random supported schema together with a value that conforms to it, then breaks one rule.
  let seed = 20261004;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  type Gen = { schema: Record<string, unknown>; value: unknown; breaks: [unknown, string][] };
  function gen(depth: number): Gen {
    const kind = pick(depth > 2 ? ['string', 'integer', 'enum'] : ['string', 'integer', 'enum', 'array', 'object']);
    if (kind === 'string') {
      const n = Math.floor(rnd() * 6);
      return {
        schema: { type: 'string', minLength: n, maxLength: n + 2 },
        value: 'a'.repeat(n + 1),
        breaks: [['a'.repeat(n + 3), 'VALUE_TOO_LONG'], [7, 'VALUE_TYPE']],
      };
    }
    if (kind === 'integer') {
      const lo = Math.floor(rnd() * 10);
      return {
        schema: { type: 'integer', minimum: lo, maximum: lo + 5 },
        value: lo + 2,
        breaks: [[lo + 6, 'VALUE_ABOVE_MAXIMUM'], [lo - 1, 'VALUE_BELOW_MINIMUM'], [lo + 0.5, 'VALUE_TYPE']],
      };
    }
    if (kind === 'enum') {
      const xs = [pick(['a', 'b']), { k: pick([1, 2]) }, pick([[1], [2]])];
      return { schema: { enum: xs }, value: structuredClone(xs[1]), breaks: [['zz', 'VALUE_ENUM']] };
    }
    if (kind === 'array') {
      const item = gen(depth + 1);
      const min = 1 + Math.floor(rnd() * 2);
      return {
        schema: { type: 'array', minItems: min, maxItems: min + 1, items: item.schema },
        value: Array.from({ length: min }, () => structuredClone(item.value)),
        breaks: [
          [[], 'VALUE_TOO_FEW_ITEMS'],
          [Array.from({ length: min + 2 }, () => structuredClone(item.value)), 'VALUE_TOO_MANY_ITEMS'],
          ...item.breaks.slice(0, 1).map(([b, c]): [unknown, string] => [[b, ...Array.from({ length: min - 1 }, () => item.value)], c]),
        ],
      };
    }
    const names = ['p', 'q', 'r'].slice(0, 1 + Math.floor(rnd() * 3));
    const subs = names.map(() => gen(depth + 1));
    const props = Object.fromEntries(names.map((n, i) => [n, subs[i].schema]));
    const value = Object.fromEntries(names.map((n, i) => [n, structuredClone(subs[i].value)]));
    const extra = pick([false, { type: 'integer' }]);
    return {
      schema: { type: 'object', required: names, properties: props, additionalProperties: extra },
      value,
      breaks: [
        [{}, 'VALUE_REQUIRED'],
        [{ ...value, zzz: 'x' }, extra === false ? 'VALUE_NOT_ALLOWED' : 'VALUE_TYPE'],
        [{ ...value, [names[0]]: subs[0].breaks[0][0] }, subs[0].breaks[0][1]],
      ],
    };
  }

  it('300 random schemas are supported, accept their value, and refuse each broken value with the expected code', () => {
    for (let i = 0; i < 300; i++) {
      const g = gen(0);
      expect(validateSchema(g.schema), JSON.stringify(g.schema)).toEqual([]);
      expect(validateValue(g.schema, g.value), JSON.stringify([g.schema, g.value])).toEqual([]);
      for (const [bad, code] of g.breaks)
        expect(validateValue(g.schema, bad).map((p) => p.code), JSON.stringify([g.schema, bad])).toContain(code);
    }
  });

  it('adding any unsupported keyword anywhere in a random schema is always found, once, with its path', () => {
    for (let i = 0; i < 100; i++) {
      const g = gen(0);
      const s = structuredClone(g.schema) as Record<string, any>;
      let node = s;
      let path = '$';
      while (node.items || node.properties) {
        if (node.items) { node = node.items; path += '.items'; }
        else { const k = Object.keys(node.properties)[0]; node = node.properties[k]; path += `.properties.${k}`; }
      }
      node.uniqueItems = true;
      expect(validateSchema(s).map((p) => `${p.code}@${p.path}`)).toEqual([`SCHEMA_UNSUPPORTED_KEYWORD@${path}.uniqueItems`]);
    }
  });
});
