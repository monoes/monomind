// P3.4 parity: the runtime document modules (packages/@monomind/cli/src/orgrt/documents/) against the harness
// prototype that was measured (schema.ts, checks.ts) and against the committed parallel-sweep-3 contracts. The
// runtime port must give the same answers on every case the prototype measured: the sweep sheet schemas, the
// injected faults (wrong value, reversed files, duplicate sheet) and doc_check. No model, no corpus build.
// @ts-nocheck: plain .mjs modules and fixtures
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertSupportedChecks as runtimeAssertChecks,
  runChecks as runtimeRunChecks,
} from '../../../../packages/@monomind/cli/src/orgrt/documents/checks.js';
import {
  contractRevision,
  validateContract,
} from '../../../../packages/@monomind/cli/src/orgrt/documents/contract.js';
import {
  checkAgainstSchema as runtimeCheckSchema,
  validateSchema,
} from '../../../../packages/@monomind/cli/src/orgrt/documents/schema-dialect.js';
import {
  assertSupportedChecks as protoAssertChecks,
  runChecks as protoRunChecks,
} from './checks.js';
import { applyContractTemplate } from './contract-template.js';
import { faultInjector, planFaults } from './fault-injection.js';
import {
  assertSupportedSchema as protoAssertSchema,
  checkAgainstSchema as protoCheckSchema,
} from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const variant = pilot.variants.find((v) => v.id === 'v2');
const V1 = pilot.contracts;
const V2 = applyContractTemplate(V1, variant.contract_template);
const DOCS = V2.map((c) => c.id);
const worker = (doc) => `worker-${doc.at(-1)}`;
const mods = (doc) => [1, 2, 3, 4].map((i) => `m${4 * (Number(doc.at(-1)) - 1) + i}`);

const sheetOf = (m, w) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, qi) => {
    const files = Array.from(
      { length: 4 + (qi % 4) },
      (_, i) => `${m}/f${(qi * 7 + i * 3 + w) % 50}.js`,
    );
    const value = 1000 * w + 10 * qi + Number(m.slice(1));
    return {
      q: `q${String(qi + 1).padStart(2, '0')}`,
      value,
      files,
      evidence: files.map((file, i) => ({ file, in: 7 + i, out: i === 0 ? value : 100 + 13 * i })),
    };
  }),
});
const correctDoc = (doc) => ({
  worker: worker(doc),
  sheets: mods(doc).map((m) => sheetOf(m, Number(doc.at(-1)))),
});

describe('the committed sweep contracts through the runtime dialect', () => {
  it('every v1 and v2 schema is inside org-schema-v1, and the runtime refuses nothing the prototype accepted', () => {
    for (const c of [...V1, ...V2]) {
      expect(() => protoAssertSchema(c.schema)).not.toThrow();
      expect(validateSchema(c.schema), c.id).toEqual([]);
    }
  });

  it('every v2 contract is a valid runtime contract when its fields are mapped', () => {
    for (const c of V2) {
      const rc = {
        type: c.id,
        schema: c.schema,
        checks: c.checks,
        deliverable_files: c.deliverables,
        max_publish_attempts: c.max_attempts,
        max_consistency_refusals: c.max_refusals,
        max_bytes: c.max_chars,
      };
      expect(validateContract(rc), c.id).toEqual([]);
    }
  });

  it('revision hash golden values for the eight v1 contracts (independent canonicalisation and sha-256)', () => {
    const golden = [
      '04ceeeeff88cd4577303521c2c2e6dab790a7d573dd5faae885f7007539b8e79',
      '2778ca7a87f8aa24ac2d98531b3f7ae653202825d4ca85740f089a3edb17f7fc',
      '0801f8c9c5de78b64a02777c76d91e0553aae22f577899607ab316e84140a817',
      '2925ab0279ab2937d4bd5463f659c6a8f013c0fed23cf1a4a96b8c78bc7479dd',
      '56f2f6e1b9254cdb0a9f5083dfe03d5e17cd3792d7291a15ff5cebb9d9e2b61c',
      '246cab79110fce00a6395b954cdaef43aeeb49104b77501e8040c97e2018d0fe',
      'b6e29d22748288a42a55b08ca7e4de53e00a98451710f525a6a88e4e637d216a',
      '35ecb9f514485fc1a501a89fc2d2af9f2851c8fbcdb207ece186042c9b701814',
    ];
    expect(V1.map((c, i) => `module-sheets-w${i + 1}` === c.id)).toEqual(Array(8).fill(true));
    expect(
      V1.map(
        (c) =>
          contractRevision({ type: c.id, schema: c.schema, max_publish_attempts: c.max_attempts })
            .revision,
      ),
    ).toEqual(golden);
  });

  it('the v2 template changes the revision (schema, checks, deliverable files)', () => {
    const rev = (c) =>
      contractRevision({
        type: c.id,
        schema: c.schema,
        checks: c.checks,
        deliverable_files: c.deliverables,
        max_publish_attempts: c.max_attempts,
        max_bytes: c.max_chars,
      }).revision;
    const v1 = V1.map(
      (c) =>
        contractRevision({ type: c.id, schema: c.schema, max_publish_attempts: c.max_attempts })
          .revision,
    );
    expect(V2.map(rev).filter((r, i) => r !== v1[i])).toHaveLength(8);
    expect(new Set(V2.map(rev)).size).toBe(8);
  });
});

describe('schema checks give the same problems as the prototype on the measured documents', () => {
  const same = (c, doc) =>
    expect(runtimeCheckSchema(c.schema, doc)).toEqual(protoCheckSchema(c.schema, doc));

  it('a correct document conforms under both', () => {
    for (const c of V2) {
      same(c, correctDoc(c.id));
      expect(runtimeCheckSchema(c.schema, correctDoc(c.id))).toEqual([]);
    }
  });

  it('every injected fault class, and a seeded set of random corruptions, give identical problem lists', () => {
    for (const seed of [20261001, 20261004, 7]) {
      const plan = planFaults(seed, DOCS);
      const inj = faultInjector(plan);
      for (const f of plan.faults) {
        const c = V2.find((x) => x.id === f.doc);
        const r = inj.apply(f.doc, correctDoc(f.doc));
        expect(r, `${seed} ${f.class}`).toBeDefined();
        same(c, r.content);
      }
    }
    let s = 99;
    const rnd = (n) => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) % n;
    for (let i = 0; i < 400; i++) {
      const c = V2[rnd(8)];
      const d = correctDoc(c.id);
      const sh = d.sheets[rnd(4)];
      const a = sh.answers[rnd(12)];
      const mutations = [
        () => {
          a.value = a.value + 0.5;
        },
        () => {
          a.value = String(a.value);
        },
        () => {
          delete a.files;
        },
        () => {
          a.files = a.files.slice(0, rnd(9));
        },
        () => {
          a.extra = 1;
        },
        () => {
          a.q = 'q99';
        },
        () => {
          sh.answers.pop();
        },
        () => {
          sh.module = 'm99';
        },
        () => {
          d.sheets.pop();
        },
        () => {
          d.worker = 'worker-9';
        },
        () => {
          a.evidence = [];
        },
        () => {
          a.evidence[0].out = 'x';
        },
        () => {
          delete d.sheets;
        },
        () => {
          d.sheets = null;
        },
        () => {
          a.files[0] = 1;
        },
      ];
      mutations[rnd(mutations.length)]();
      same(c, d);
    }
  });
});

describe('the dialect refuses what the prototype refused (and accepts what it accepted)', () => {
  const protoRefuses = (s) => {
    try {
      protoAssertSchema(s);
      return false;
    } catch {
      return true;
    }
  };
  const runtimeRefuses = (s) => validateSchema(s).length > 0;

  it('agree on the prototype keyword set and on every refused keyword', () => {
    const ok = [
      {},
      { type: 'string' },
      { type: 'integer', minimum: 1, maximum: 2 },
      { enum: ['a', 1] },
      {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: { type: 'string', minLength: 1, maxLength: 3 },
      },
      {
        type: 'object',
        required: ['a'],
        additionalProperties: false,
        properties: { a: { title: 't', description: 'd' } },
      },
    ];
    for (const s of ok) expect([protoRefuses(s), runtimeRefuses(s)]).toEqual([false, false]);
    const refused = [
      'pattern',
      'format',
      'oneOf',
      'anyOf',
      'allOf',
      'not',
      '$ref',
      'minProperties',
      'uniqueItems',
      'multipleOf',
      'default',
      'patternProperties',
    ];
    for (const k of refused) {
      expect([protoRefuses({ [k]: 1 }), runtimeRefuses({ [k]: 1 })], k).toEqual([true, true]);
      expect(
        [
          protoRefuses({ properties: { a: { [k]: 1 } } }),
          runtimeRefuses({ properties: { a: { [k]: 1 } } }),
        ],
        k,
      ).toEqual([true, true]);
    }
  });

  it('the runtime widens the prototype only as the spec says: const, examples, $schema, schema-valued additionalProperties', () => {
    for (const s of [
      { const: 1 },
      { examples: [1] },
      { $schema: 'https://json-schema.org/draft/2020-12/schema' },
      { additionalProperties: { type: 'string' } },
    ])
      expect([protoRefuses(s), runtimeRefuses(s)]).toEqual([true, false]);
  });
});

describe('checks give the same results as the prototype, including the injected faults', () => {
  const checks = variant.contract_template.checks;

  it('the checks dialect refuses and accepts the same lists', () => {
    const lists = [
      checks,
      [],
      [{ type: 'sum_equals' }],
      [{ type: 'files_match_evidence', x: 1 }],
      [{ type: 'value_type', is: 'string' }],
      [{ type: 'value_type' }],
      'x',
      [3],
    ];
    for (const l of lists) {
      const p = (() => {
        try {
          protoAssertChecks(l, 'c');
          return null;
        } catch (e) {
          return e.message;
        }
      })();
      const r = (() => {
        try {
          runtimeAssertChecks(l, 'c');
          return null;
        } catch (e) {
          return e.message;
        }
      })();
      expect(r === null, JSON.stringify(l)).toBe(p === null);
    }
  });

  it('the honest documents pass; the three injected fault classes are flagged exactly as in the v2 test', () => {
    for (const doc of DOCS)
      expect(runtimeRunChecks(checks, correctDoc(doc))).toEqual(
        protoRunChecks(checks, correctDoc(doc)),
      );
    const plan = planFaults(20261004, DOCS);
    const inj = faultInjector(plan);
    const flagged = {};
    for (const doc of DOCS) {
      const injected = inj.apply(doc, correctDoc(doc));
      const content = injected ? injected.content : correctDoc(doc);
      const r = runtimeRunChecks(checks, content);
      expect(r).toEqual(protoRunChecks(checks, content));
      if (r.flagged.length || r.doc_level.length) flagged[doc] = r;
    }
    expect(Object.keys(flagged).sort()).toEqual(plan.faults.map((f) => f.doc).sort());
    const by = (cls) => flagged[plan.faults.find((f) => f.class === cls).doc];
    expect(by('wrong-value-q05').flagged.map((x) => [x.q, x.failed.map((y) => y.check)])).toEqual([
      ['q05', ['value_matches_chain']],
    ]);
    expect(by('wrong-value-q07').flagged).toHaveLength(1);
    expect(by('files-order').flagged.map((x) => x.q)).toEqual(['q01', 'q02']);
    expect(by('files-order').flagged[0].failed[0].check).toBe('files_match_evidence');
    expect(by('duplicate-sheet').doc_level[0].check).toBe('unique_across_sheets');
    expect(
      by('duplicate-sheet').flagged.every((x) =>
        x.failed.some((y) => y.check === 'files_in_module'),
      ),
    ).toBe(true);
  });

  it('a seeded set of random corruptions gives identical check results', () => {
    let s = 5;
    const rnd = (n) => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) % n;
    for (let i = 0; i < 400; i++) {
      const doc = DOCS[rnd(8)];
      const d = correctDoc(doc);
      const sh = d.sheets[rnd(4)];
      const a = sh.answers[rnd(12)];
      [
        () => {
          a.value += rnd(20) + 1;
        },
        () => {
          a.files.reverse();
        },
        () => {
          a.value = 'x';
        },
        () => {
          a.evidence.pop();
        },
        () => {
          a.evidence[0].out += 1;
        },
        () => {
          delete a.evidence;
        },
        () => {
          d.sheets[1].answers = structuredClone(d.sheets[0].answers);
        },
        () => {
          a.files[1] = 'other/x.js';
        },
        () => {
          sh.module = 'm0';
        },
      ][rnd(9)]();
      expect(runtimeRunChecks(checks, d)).toEqual(protoRunChecks(checks, d));
    }
  });
});
