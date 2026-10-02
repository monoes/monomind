#!/usr/bin/env node
// Blinded review of what machine checks cannot judge (org sections spec 10: "a reviewer with
// contender identity concealed approves under a fixed rubric").
//
//   review.mjs pack --out <dir> <trial root>...
//     One bundle per trial that has a unit awaiting review: the files the trial added or
//     changed in its workspace, the manifest's rubric, and a review.json to fill. Bundles carry
//     random ids; the key mapping ids to trials is written to <dir>/key.json, which a reviewer
//     must not read. Nothing in a bundle names the contender, the runner or the model.
//   review.mjs apply <dir>
//     Folds each filled review.json into its trial's units.json: a unit awaiting review is
//     accepted when its rubric score reaches the manifest's min_quality with no critical
//     failure; a unit the machine accepted but flagged needsReview is accepted only if both agree.
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const manifestFor = (scenario) => readJson(join(here, '../manifests', `${scenario}.json`));

function listFiles(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile())
        out.set(relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Files the trial added or changed against its immutable inputs, minus the read-only research
 *  material every trial carries (`snapshot/`), dot entries and the runtime's own files. */
export function producedFiles(workspace, inputsWorkspace) {
  const before = listFiles(inputsWorkspace);
  return [...listFiles(workspace)]
    .filter(([f, h]) => before.get(f) !== h)
    .map(([f]) => f)
    .filter((f) => !f.startsWith('snapshot/') && !f.split('/').some((s) => s.startsWith('.')));
}

const needsReview = (u) => u.accepted === null || u.evidence?.needsReview === true;

export function pack({ roots, out }) {
  out = resolve(out);
  mkdirSync(out, { recursive: true });
  const key = {};
  const ids = new Set();
  for (const root of roots.map((r) => resolve(r))) {
    const trial = readJson(join(root, 'trial.json'));
    const units = readJson(join(root, 'units.json')).units;
    const pending = [...new Set(units.filter(needsReview).map((u) => u.unit))];
    if (!pending.length) continue;
    const manifest = manifestFor(trial.scenario);
    let id;
    do id = `B-${randomBytes(3).toString('hex')}`;
    while (ids.has(id));
    ids.add(id);
    const dir = join(out, id);
    mkdirSync(join(dir, 'artifacts'), { recursive: true });
    for (const f of producedFiles(join(root, 'workspace'), join(trial.guard[0], 'workspace'))) {
      mkdirSync(dirname(join(dir, 'artifacts', f)), { recursive: true });
      cpSync(join(root, 'workspace', f), join(dir, 'artifacts', f));
    }
    const wanted = manifest.units.filter((u) => pending.includes(u.id));
    const template = {
      note: 'Set every criterion to true or false, list any critical failures that apply, and add short notes. Judge only what is in artifacts/.',
      units: Object.fromEntries(
        wanted.map((u) => [
          u.id,
          {
            criteria: Object.fromEntries(manifest.rubric.criteria.map((c) => [c.id, null])),
            critical: [],
            notes: '',
          },
        ]),
      ),
    };
    writeJson(join(dir, 'review.json'), template);
    writeFileSync(
      join(dir, 'REVIEW.md'),
      [
        `# Review ${id}`,
        '',
        'You are reviewing work whose author you do not know. Read only the files in `artifacts/`. Fill `review.json`.',
        '',
        '## Units to judge',
        ...wanted.map((u) => `- **${u.id}**: ${u.description}. Evidence expected: ${u.evidence}`),
        '',
        '## Rubric (every criterion true or false, per unit)',
        ...manifest.rubric.criteria.map((c) => `- **${c.id}**: ${c.description}`),
        '',
        `A unit is accepted when at least ${Math.round(manifest.rubric.min_quality * 100)}% of the criteria are true and no critical failure applies.`,
        '',
        '## Critical failures (any one rejects the unit; list the ones that apply)',
        ...manifest.rubric.critical_failures.map((c) => `- ${c}`),
        '',
        `Completion rule: ${manifest.completion_rule}`,
        '',
      ].join('\n'),
    );
    key[id] = { root, scenario: trial.scenario, units: pending };
  }
  writeJson(join(out, 'key.json'), key);
  return Object.keys(key);
}

export function apply({ out }) {
  out = resolve(out);
  const key = readJson(join(out, 'key.json'));
  const applied = [];
  for (const [id, k] of Object.entries(key)) {
    const review = readJson(join(out, id, 'review.json'));
    const manifest = manifestFor(k.scenario);
    const unitsFile = join(k.root, 'units.json');
    const file = readJson(unitsFile);
    for (const unitId of k.units) {
      const r = review.units?.[unitId];
      if (!r) throw new Error(`${id}: review.json has no entry for unit ${unitId}`);
      const crit = manifest.rubric.criteria.map((c) => r.criteria?.[c.id]);
      if (crit.some((v) => typeof v !== 'boolean'))
        throw new Error(`${id}: ${unitId} has an unanswered criterion`);
      const score = crit.filter(Boolean).length / crit.length;
      const pass = score >= manifest.rubric.min_quality && (r.critical ?? []).length === 0;
      for (const u of file.units.filter((x) => x.unit === unitId && needsReview(x))) {
        const machine = u.accepted;
        u.accepted = machine === null ? pass : machine && pass;
        u.review = {
          id,
          score,
          critical: r.critical ?? [],
          notes: r.notes ?? '',
          machineAccepted: machine,
        };
        if ((r.critical ?? []).length) u.critical = [...(u.critical ?? []), ...r.critical];
        if (u.evidence) u.evidence.needsReview = false;
      }
    }
    writeJson(unitsFile, file);
    applied.push(id);
  }
  return applied;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'pack') {
    const i = rest.indexOf('--out');
    const out = rest[i + 1];
    console.log(pack({ roots: rest.filter((_, j) => j !== i && j !== i + 1), out }).join('\n'));
  } else if (cmd === 'apply') console.log(apply({ out: rest[0] }).join('\n'));
  else {
    console.error('usage: review.mjs pack --out <dir> <trial root>... | apply <dir>');
    process.exit(2);
  }
}
