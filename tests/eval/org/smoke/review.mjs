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
import { homedir } from 'node:os';
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

const TEXT_EXT = /\.(md|txt|json|jsonl|sh|mjs|js|ts|yml|yaml|csv|html|toml)$/i;
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Labels under which a plain role id names who wrote something (front matter, bylines, assignments). */
const LABEL =
  /\b(author|owner|assignee|assigned[ _-]?to|role|from|to|produced[ _-]?by|created[ _-]?by|written[ _-]?by|reviewer)(\**\s*[:=]\s*\**)\s*/i;

/** Text with what identifies the producer removed: the trial's path, other scratch and home paths, the
 *  org and trial names, run ids, hyphenated role ids, and plain role ids where they label an author. Prose
 *  that merely uses a role's word ("a researcher would check this") is content and stays. */
export function scrub(text, { root, names = [], roleIds = [], home = homedir() }) {
  let t = text;
  if (root) t = t.split(root).join('<trial>');
  for (const n of [...names].sort((a, b) => b.length - a.length)) t = t.split(n).join('<org>');
  t = t.replace(/\/(?:var\/tmp|tmp)\/[\w./-]*/g, '<path>');
  if (home) t = t.split(home).join('<home>');
  t = t.replace(/\brun-\d{8,14}-[a-z0-9]+/g, '<run>');
  for (const id of roleIds.filter((r) => r.includes('-')).sort((a, b) => b.length - a.length))
    t = t.replace(new RegExp(`(?<![A-Za-z0-9])${esc(id)}(?![A-Za-z0-9])`, 'g'), '<role>');
  const plain = roleIds.filter((r) => !r.includes('-'));
  if (plain.length) {
    const ids = plain.map(esc).join('|');
    t = t.replace(
      new RegExp(`${LABEL.source}(${ids})\\b`, 'gi'),
      (_m, label, sep) => `${label}${sep}<role>`,
    );
  }
  return t;
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
    // Who made the bundle's files must not show in them: scrub what they say and what they are called.
    const orgFile = join(root, '.monomind/orgs', `${trial.name}.json`);
    // The whole original roster, not only this trial's roles: a one-role arm must scrub the same names as the others.
    const inputsOrg = join(trial.guard[0], 'org.json');
    const roleIds = [
      ...new Set([
        ...(existsSync(orgFile) ? readJson(orgFile).roles.map((r) => r.id) : []),
        ...(existsSync(inputsOrg) ? readJson(inputsOrg).roles.map((r) => r.id) : []),
      ]),
    ];
    const ctx = { root, names: [trial.name], roleIds };
    const renamed = {};
    for (const f of producedFiles(join(root, 'workspace'), join(trial.guard[0], 'workspace'))) {
      const to = scrub(f, ctx);
      if (to !== f) renamed[to] = f;
      mkdirSync(dirname(join(dir, 'artifacts', to)), { recursive: true });
      const from = join(root, 'workspace', f);
      if (TEXT_EXT.test(f))
        writeFileSync(join(dir, 'artifacts', to), scrub(readFileSync(from, 'utf8'), ctx));
      else cpSync(from, join(dir, 'artifacts', to));
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
    key[id] = {
      root,
      scenario: trial.scenario,
      units: pending,
      ...(Object.keys(renamed).length ? { renamed } : {}),
    };
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
