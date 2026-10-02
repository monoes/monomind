// The six cross-module questions and how their answers derive from the eight module truths.
// Shared by the generator (which writes the synthesis truth), the reference flows and the tests.
// A question that needs a module that is missing from the input is unanswerable (null) unless
// `allowPartial` is set, which computes over whatever modules are present (used to show the
// answer would then be wrong, not merely absent).

export const MODULE_IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

export const SYNTHESIS_QUESTIONS = [
  {
    q: 's1',
    text: 'Which module has the largest value for its q03 chain? Answer with the module id, for example "m4".',
  },
  {
    q: 's2',
    text: 'What is the sum of the q07 values of modules m2, m5 and m8? Answer with an integer.',
  },
  {
    q: 's3',
    text: 'Which module has the longest q01 chain (the most files)? Answer with the module id.',
  },
  {
    q: 's4',
    text: 'Which three q12 values are the smallest across all modules, in ascending order? Answer with a list of three strings of the form "<module>:<value>", for example ["m3:112","m6:130","m1:140"].',
  },
  {
    q: 's5',
    text: 'What is the sum of the q05 values of all eight modules? Answer with an integer.',
  },
  {
    q: 's6',
    text: 'Which module has the smallest sum of its q01, q02 and q03 values? Answer with the module id.',
  },
];

const QS = (n) => `q${String(n).padStart(2, '0')}`;
const value = (mods, m, q) => mods[m]?.[q]?.value;

/** modules: { m1: { q01: { value, files }, ... }, ... } -> { s1: value | null, ... } */
export function deriveSynthesis(modules, { allowPartial = false } = {}) {
  const need = (list, f) => {
    const have = list.every((m) => modules[m]);
    return have || allowPartial ? f(list.filter((m) => modules[m])) : null;
  };
  const argBy = (list, score, dir) =>
    list.reduce((best, m) => (best === null || dir * (score(m) - score(best)) > 0 ? m : best), null);
  const all = MODULE_IDS;
  const sum = (l, ...qs) => l.reduce((a, m) => a + qs.reduce((b, q) => b + value(modules, m, q), 0), 0);
  return {
    s1: need(all, (l) => argBy(l, (m) => value(modules, m, QS(3)), 1)),
    s2: need(['m2', 'm5', 'm8'], (l) => sum(l, QS(7))),
    s3: need(all, (l) => argBy(l, (m) => modules[m][QS(1)].files.length, 1)),
    s4: need(all, (l) =>
      l
        .map((m) => ({ m, v: value(modules, m, QS(12)) }))
        .sort((a, b) => a.v - b.v || (a.m < b.m ? -1 : 1))
        .slice(0, 3)
        .map((e) => `${e.m}:${e.v}`),
    ),
    s5: need(all, (l) => sum(l, QS(5))),
    s6: need(all, (l) => argBy(l, (m) => sum([m], QS(1), QS(2), QS(3)), -1)),
  };
}

/** True when the derived answers are unambiguous: no ties where a question needs a unique winner. */
export function isUnambiguous(modules) {
  const unique = (score, dir) => {
    const s = MODULE_IDS.map(score).sort((a, b) => dir * (b - a));
    return s[0] !== s[1];
  };
  const q12 = MODULE_IDS.map((m) => value(modules, m, QS(12))).sort((a, b) => a - b);
  return (
    unique((m) => value(modules, m, QS(3)), 1) &&
    unique((m) => modules[m][QS(1)].files.length, 1) &&
    unique((m) => value(modules, m, QS(1)) + value(modules, m, QS(2)) + value(modules, m, QS(3)), -1) &&
    q12[0] !== q12[1] &&
    q12[1] !== q12[2] &&
    q12[2] !== q12[3]
  );
}
