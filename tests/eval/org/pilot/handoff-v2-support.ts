// Shared setup of the variant v2 scripted tests (handoff-v2*.test.ts): the v2 contracts, the corpus truth, a worker's
// files and document, and a trial built on the real store with a recording relay. No model is called.
// @ts-nocheck: plain .mjs modules
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { applyContractTemplate } from './contract-template.js';
import { faultInjector, planFaults } from './fault-injection.js';
import { HandoffStore } from './store.js';
import { pilotTools } from './tools.js';

const here = dirname(fileURLToPath(import.meta.url));
export const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
export const variant = pilot.variants.find((v: { id: string }) => v.id === 'v2');
export const V1 = pilot.contracts;
export const V2 = applyContractTemplate(V1, variant.contract_template);
export const DOCS: string[] = V2.map((c: { id: string }) => c.id);
export const worker = (doc: string) => `worker-${doc.at(-1)}`;
export const mods = (doc: string) =>
  [1, 2, 3, 4].map((i) => `m${4 * (Number(doc.at(-1)) - 1) + i}`);

/** Filled by the hooks `useV2Corpus` registers. */
export const S: { tmp: string; truth: any } = { tmp: '', truth: undefined };
export function useV2Corpus() {
  beforeAll(() => {
    const tmp = (S.tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'v2-')));
    execFileSync(
      process.execPath,
      [
        join(here, '../fixtures/parallel-sweep/build-corpus.mjs'),
        join(tmp, 'corpus'),
        '--truth',
        join(tmp, 'truth.json'),
        '--modules',
        '32',
      ],
      { encoding: 'utf8' },
    );
    S.truth = JSON.parse(readFileSync(join(tmp, 'truth.json'), 'utf8'));
  });
  afterAll(() => rmSync(S.tmp, { recursive: true, force: true }));
}

/** What a worker's out/<module>/answers.json holds: the strict scorer shape, no evidence. */
export const fileSheet = (m: string) => ({
  module: m,
  answers: Object.entries(S.truth.modules[m]).map(([q, t]: [string, any]) => ({
    q,
    value: t.value,
    files: t.files,
  })),
});
/** An honest trace: the entry function returns the value, the other steps carry made-up integers (the scripts never run code). */
export const docSheet = (m: string) => ({
  ...fileSheet(m),
  answers: fileSheet(m).answers.map((a) => ({
    ...a,
    evidence: a.files.map((file: string, i: number) => ({
      file,
      in: 7 + i,
      out: i === 0 ? a.value : 100 + 13 * i,
    })),
  })),
});
export const correctDoc = (doc: string) => ({
  worker: worker(doc),
  sheets: mods(doc).map(docSheet),
});
export const filePath = (root: string, m: string) => join(root, 'workspace/out', m, 'answers.json');
export const writeFiles = (root: string) => {
  for (let i = 1; i <= 32; i++) {
    mkdirSync(join(root, 'workspace/out', `m${i}`), { recursive: true });
    writeFileSync(filePath(root, `m${i}`), JSON.stringify(fileSheet(`m${i}`)));
  }
};

export function trial(
  faultSeed: number | null,
  o: { relay?: boolean; contracts?: any[]; notice?: boolean } = {},
) {
  const root = mkdtempSync(join(S.tmp, 't-'));
  writeFiles(root);
  const sent: { to: string; subject: string; body: string }[] = [];
  const plan = faultSeed === null ? undefined : planFaults(faultSeed, DOCS);
  const store = new HandoffStore(
    join(root, 'pilot-state'),
    o.contracts ?? V2,
    undefined,
    plan ? faultInjector(plan) : undefined,
    {
      workspace: join(root, 'workspace'),
      ...(o.relay === false
        ? {}
        : {
            relay: (m) => {
              sent.push(m);
              return undefined;
            },
            copyTo: ['lead'],
            ...(o.notice ? { consumerNotice: true } : {}),
          }),
    },
  );
  const as = (role: string) => {
    const tools = pilotTools(store, role);
    return async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(
        (await tools.find((t) => t.name === `pilot__${name}`)!.handler(args, {} as never)).text,
      );
  };
  return { root, plan, store, sent, as };
}
export type T = ReturnType<typeof trial>;
export const publishAll = async (t: T) => {
  for (const doc of DOCS)
    expect(
      await t.as(worker(doc))('doc_publish', { doc_id: doc, content: correctDoc(doc) }),
    ).toMatchObject({ ok: true });
};
export const events = (t: T, kind: string) => t.store.events().filter((e) => e.kind === kind);
