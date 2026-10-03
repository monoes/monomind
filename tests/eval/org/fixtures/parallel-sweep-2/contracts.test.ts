// parallel-sweep-2 hand-off contracts (treatment arm): one contract per worker holding its four module sheets, in the
// fail-closed dialect; reference sheets validate, missing/extra/wrong-type fields are refused. No model is called.
// @ts-nocheck: the fixture scripts are plain .mjs modules without type declarations
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertSupportedSchema, checkAgainstSchema } from '../../pilot/schema.js';
import { moduleIds } from '../parallel-sweep/synthesis.mjs';
import { referenceDeliverables } from './hidden/reference/write-answers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const generator = join(here, '../parallel-sweep/build-corpus.mjs');
const _record = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));
const pilot = JSON.parse(
  readFileSync(join(here, '../../pilot/parallel-sweep-2.pilot.json'), 'utf8'),
);
const MODULES = moduleIds(32);

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
const _hashOf = (dir: string) => {
  const h = createHash('sha256');
  for (const f of walk(dir).sort())
    h.update(`${f}\0`)
      .update(readFileSync(join(dir, f)))
      .update('\0');
  return h.digest('hex');
};
const build = () => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sweep2-'));
  const corpus = join(root, 'corpus');
  const truth = join(root, 'truth.json');
  const r = spawnSync('node', [generator, corpus, '--truth', truth, '--modules', '32'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return { root, corpus, truth, truthDoc: JSON.parse(readFileSync(truth, 'utf8')) };
};
const _write = (dir: string, deliverables: Record<string, unknown>) => {
  for (const [p, doc] of Object.entries(deliverables)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), JSON.stringify(doc));
  }
  return dir;
};
const _scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sweep2-out-'));

let a: ReturnType<typeof build>;
beforeAll(() => {
  a = build();
});
const truth = () => a.truthDoc;

describe('the module-sheets hand-off contracts (treatment arm): one per worker, four sheets each', () => {
  const contract = (k: number) => pilot.contracts.find((c: any) => c.id === `module-sheets-w${k}`);
  const doc = (k: number) => ({
    worker: `worker-${k}`,
    sheets: MODULES.slice(4 * k - 4, 4 * k).map(
      (m) => (referenceDeliverables(truth(), 'complete') as any)[`${m}/answers.json`],
    ),
  });

  it('are 8, producer worker-k, consumer the synthesiser, in the fail-closed dialect, across sections', () => {
    expect(pilot.contracts.map((c: any) => c.id)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `module-sheets-w${k}`),
    );
    pilot.contracts.forEach((c: any, i: number) => {
      expect(c.producer).toBe(`worker-${i + 1}`);
      expect(c.consumers).toEqual(['synthesiser']);
      expect(() => assertSupportedSchema(c.schema)).not.toThrow();
    });
  });

  it('every reference worker document validates, and each holds exactly its own four modules', () => {
    for (let k = 1; k <= 8; k++) {
      expect(checkAgainstSchema(contract(k).schema, doc(k))).toEqual([]);
      expect(contract(k).schema.properties.sheets.items.properties.module.enum).toEqual(
        MODULES.slice(4 * k - 4, 4 * k),
      );
    }
  });

  it('refuses a missing field, an extra field, a wrong type, a foreign module, a wrong worker and a missing sheet', () => {
    const schema = contract(1).schema;
    const mut = (f: (d: any) => void) => {
      const d = doc(1);
      f(d);
      return checkAgainstSchema(schema, d);
    };
    expect(mut((d) => delete d.sheets[0].answers[0].files)).toEqual([
      '$.sheets[0].answers[0].files: required',
    ]);
    expect(mut((d) => (d.note = 'x'))).toEqual(['$.note: not allowed']);
    expect(mut((d) => (d.sheets[1].answers[3].confidence = 1))).toEqual([
      '$.sheets[1].answers[3].confidence: not allowed',
    ]);
    expect(mut((d) => (d.sheets[2].answers[2].value = '42'))).toEqual([
      '$.sheets[2].answers[2].value: expected integer, got string',
    ]);
    expect(mut((d) => (d.sheets[3].module = 'm5'))).toHaveLength(1);
    expect(mut((d) => (d.worker = 'worker-2'))).toHaveLength(1);
    expect(mut((d) => d.sheets.pop())).toEqual(['$.sheets: fewer than 4 items']);
    expect(mut((d) => d.sheets[0].answers.pop())).toEqual([
      '$.sheets[0].answers: fewer than 12 items',
    ]);
  });

  it('five sections (four worker pairs and the synthesis) and a different section for each producer and the consumer', () => {
    expect(Object.keys(pilot.routing.sections)).toEqual([
      'sweep-a',
      'sweep-b',
      'sweep-c',
      'sweep-d',
      'synthesis',
    ]);
    expect(
      Object.values(pilot.routing.sections)
        .flatMap((s: any) => [s.lead, ...s.members])
        .sort(),
    ).toEqual([...Array.from({ length: 8 }, (_, i) => `worker-${i + 1}`), 'synthesiser'].sort());
  });
});
