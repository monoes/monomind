/**
 * #702: hasUnsafeShellSyntax is the only enforcement of "an allow-listed
 * prefix plus no shell metacharacters" for confined agent turns. It must not
 * be fooled by bash quoting it does not model (ANSI-C `$'..'`, locale
 * `$".."`, backslash-escaped quotes, ...).
 *
 *  - a real-bash reproduction of the `$'\''` bypass;
 *  - table tests for what must stay allowed and what must be refused;
 *  - a seeded differential fuzz: every generated argument string the scanner
 *    calls SAFE is run through real bash after an allow-listed stub command,
 *    and nothing but that stub may run.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopedCanUseTool } from '../orgrt/agent-exec-gate.js';
import { checkReadOnlyCommand } from '../orgrt/agent-exec-read.js';
import { hasUnsafeShellSyntax } from '../orgrt/agent-exec-shell-syntax.js';

const PREFIX = 'monoagentcli --profile p browser tabs';

/** A scratch dir with a `monoagentcli` stub (logs each call) and a `canary`
 *  stub (logs each call) on PATH. Only those two harmless scripts exist. */
function makeSandbox() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'shsyn-'));
  const calls = join(dir, 'calls.log');
  const canary = join(dir, 'canary.log');
  const bin = join(dir, 'bin');
  const mk = (name: string, body: string) => {
    const f = join(bin, name);
    writeFileSync(f, `#!/bin/sh\n${body}\n`);
    chmodSync(f, 0o755);
  };
  spawnSync('mkdir', ['-p', bin]);
  mk('monoagentcli', `echo "$#" >> '${calls}'`);
  for (const name of ['canary', 'touch', 'echo2', 'curl', 'sh2']) {
    mk(name, `echo "${name}" >> '${canary}'`);
  }
  // files so a surviving glob would expand into several words
  for (const f of ['a1', 'a2', 'b1']) writeFileSync(join(dir, f), '');
  const run = (cmd: string) => {
    writeFileSync(calls, '');
    writeFileSync(canary, '');
    spawnSync('bash', ['-c', cmd], {
      cwd: dir,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir },
      timeout: 10_000,
    });
    return {
      calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
      canary: readFileSync(canary, 'utf8').split('\n').filter(Boolean),
    };
  };
  return { dir, run };
}

describe('#702 ANSI-C quoting bypass', () => {
  it('the reported command really runs the injected part in bash', () => {
    const sb = makeSandbox();
    const cmd = `${PREFIX} $'\\'' ; touch /nonexistent/PWNED ; echo $'\\''`;
    // `touch` here resolves to the canary stub: it ran, so bash executed it.
    expect(sb.run(cmd).canary).toContain('touch');
  });

  it('the scanner refuses it', () => {
    expect(hasUnsafeShellSyntax(`${PREFIX} $'\\'' ; touch /tmp/PWNED ; echo $'\\''`)).toBe(true);
  });

  it('the confined gate denies it', async () => {
    const gate = scopedCanUseTool(new Set(), ['monoagentcli --profile p browser tabs']);
    const r = await gate('Bash', { command: `${PREFIX} $'\\'' ; touch /tmp/PWNED ; echo $'\\''` });
    expect(r.behavior).toBe('deny');
  });

  it('read access denies it too', () => {
    expect(checkReadOnlyCommand(`cat $'\\'' ; touch x ; echo $'\\''`).ok).toBe(false);
  });
});

describe('#702 legitimate commands stay allowed', () => {
  const ok = [
    'monoagentcli --profile p browser tabs',
    "monoagentcli --profile p note it\\'s-fine",
    'monoagentcli --profile p note a\\ b',
    'monoagentcli --profile abc-123_x browser a11y --tab 3',
    'monoagentcli --profile p aitask complete 42 --result /home/u/.monoagent/tmp/file.json',
    'monoagentcli --profile p record show 8f3a-12 --json',
    "monoagentcli --profile p browser fill '#email' 'a b'",
    "monoagentcli --profile p browser fill '#email' 'john@example.com'",
    `monoagentcli --profile p org create-json --json '{"goal":"grow revenue & cut costs"}'`,
    'monoagentcli --profile p browser type "hello; world" --tab=3',
    "monoagentcli --profile p note 'it'\"'\"'s fine'",
    "rg 'foo|bar' src",
    'grep -rn "a;b" src',
    "find . -name '*.ts' -type f",
    'git diff HEAD~1 -- src',
    'git blame -L 1,5 a.ts',
    "rg '\\bword\\b$' src",
    '  monoagentcli --profile p browser tabs  ',
    'monoagentcli --profile p\tbrowser tabs',
  ];
  it.each(ok)('allows %s', (cmd) => {
    expect(hasUnsafeShellSyntax(cmd)).toBe(false);
  });
});

describe('#702 unsafe syntax is refused', () => {
  const bad = [
    `${PREFIX} $'\\''`,
    `${PREFIX} $'a'`,
    `${PREFIX} $"a"`,
    `${PREFIX} "$"'x'`,
    `${PREFIX} \\'; touch x`,
    `${PREFIX} \\"; touch x; "`,
    `${PREFIX} \\\u2028`,
    `${PREFIX} \\é`,
    `${PREFIX} "a\\"; touch x; echo \\""`,
    `${PREFIX} ; touch x`,
    `${PREFIX} && touch x`,
    `${PREFIX} || touch x`,
    `${PREFIX} | sh`,
    `${PREFIX} & touch x`,
    `${PREFIX} \`id\``,
    `${PREFIX} "\`id\`"`,
    `${PREFIX} $(id)`,
    `${PREFIX} "$(id)"`,
    `${PREFIX} "$HOME"`,
    `${PREFIX} $HOME`,
    `${PREFIX} \${HOME}`,
    `${PREFIX} <(id)`,
    `${PREFIX} >(id)`,
    `${PREFIX} <<EOF`,
    `${PREFIX} < /etc/passwd`,
    `${PREFIX} > /tmp/x`,
    `${PREFIX} 2>&1`,
    `${PREFIX}\ntouch x`,
    `${PREFIX}\rtouch x`,
    `${PREFIX} 'a\nb'`,
    `${PREFIX} 'a\u2028b'`,
    `${PREFIX} 'a\0b'`,
    `${PREFIX} {a,b}`,
    `${PREFIX} {1..3}`,
    `${PREFIX} ~`,
    `${PREFIX} ~root`,
    `${PREFIX} --out=~/x`,
    `${PREFIX} a:~/x`,
    `${PREFIX} *`,
    `${PREFIX} ?`,
    `${PREFIX} [ab]`,
    `${PREFIX} !!`,
    `${PREFIX} "!!"`,
    `${PREFIX} a\\\nb`,
    `${PREFIX} # comment`,
    `${PREFIX} (id)`,
    `${PREFIX} 'unterminated`,
    `${PREFIX} "unterminated`,
    `${PREFIX} é`,
  ];
  it.each(bad.map((b) => [JSON.stringify(b), b]))('refuses %s', (_l, cmd) => {
    expect(hasUnsafeShellSyntax(cmd)).toBe(true);
  });
});

describe('#702 differential fuzz against real bash', () => {
  // Small seeded PRNG (mulberry32) so a failure is reproducible.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pieces = [
    "'",
    '"',
    '\\',
    '$',
    ';',
    ' ',
    ' ',
    '\n',
    '\r',
    '`',
    '{',
    '}',
    '(',
    ')',
    '&',
    '|',
    '<',
    '>',
    '*',
    '?',
    '[',
    ']',
    '!',
    '#',
    '~',
    '=',
    ':',
    '-',
    'a',
    'b',
    '1',
    ',',
    '.',
    '/',
    '%',
    '@',
    '+',
    "$'",
    '$"',
    "\\'",
    '\\"',
    '$(',
    '${',
    '<(',
    '>(',
    '<<',
    '&&',
    '||',
    ';;',
    '\\\n',
    '{a,b}',
    '{1..3}',
    '~root',
    'a*',
    'touch',
    'canary',
    'curl',
    ' ; canary ; ',
    " $'\\'' ; canary ; $'\\'' ",
    "'\\'",
    '\u2028',
    '\u0085',
    'é',
  ];
  // Second alphabet biased toward strings the scanner accepts, so the safe
  // branch gets thousands of real-bash executions, not a few hundred.
  const quoteHeavy = [
    "'",
    '"',
    '\\',
    ' ',
    ' ',
    'a',
    'b',
    '1',
    '-',
    '.',
    '/',
    '=',
    ':',
    '~',
    ',',
    '%',
    '@',
    '+',
    ';',
    '|',
    '&',
    '<',
    '>',
    '(',
    ')',
    '*',
    '?',
    '{',
    '}',
    '[',
    '#',
    'canary',
    'touch',
    "'a b'",
    '"a b"',
    "';'",
    '";"',
    "'$'",
    "'\\'",
    "\\'",
    '\\"',
    '\\ ',
    '\\;',
    '\\$',
  ];
  const CASES = 4000;
  const alphabets = [
    ['adversarial', pieces, 702],
    ['quote-heavy', quoteHeavy, 7020],
  ] as const;
  it.each(alphabets)(
    `${CASES} seeded %s strings: whatever the scanner calls safe runs only the stub`,
    (_name, alphabet, seed) => {
      const sb = makeSandbox();
      const next = rng(seed);
      let safe = 0;
      const failures: string[] = [];
      for (let n = 0; n < CASES; n++) {
        const len = 1 + Math.floor(next() * 9);
        let s = '';
        for (let k = 0; k < len; k++) s += alphabet[Math.floor(next() * alphabet.length)];
        const cmd = `${PREFIX} ${s}`;
        if (hasUnsafeShellSyntax(cmd)) continue;
        safe++;
        // If the scanner is wrong about where quoting ends, a canary stub runs,
        // the stub runs twice/not at all, or a glob/brace changes the argc.
        const r = sb.run(cmd);
        const expectedArgc = /['"\\]/.test(s) ? null : cmd.trim().split(/[ \t]+/).length - 1;
        if (
          r.canary.length > 0 ||
          r.calls.length !== 1 ||
          (expectedArgc !== null && r.calls[0] !== String(expectedArgc))
        ) {
          failures.push(`${JSON.stringify(s)} -> calls=${r.calls} canary=${r.canary}`);
        }
      }
      expect(safe).toBeGreaterThan(100);
      expect(failures).toEqual([]);
    },
    240_000,
  );

  it('the same fuzz catches the pre-fix scanner (the harness has teeth)', () => {
    // The old quote-toggle scanner, verbatim, as the oracle under test.
    const old = (cmd: string): boolean => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i];
        if (c === '\\' && !inSingle) {
          i++;
          continue;
        }
        if (c === "'" && !inDouble) {
          inSingle = !inSingle;
          continue;
        }
        if (c === '"' && !inSingle) {
          inDouble = !inDouble;
          continue;
        }
        if (inSingle) continue;
        if (c === '`') return true;
        if (c === '$' && cmd[i + 1] === '(') return true;
        if (inDouble) continue;
        if (c === ';' || c === '&' || c === '|' || c === '\n') return true;
        if (c === '>' || c === '<') return true;
      }
      return false;
    };
    const sb = makeSandbox();
    const bypass = `${PREFIX} $'\\'' ; canary ; echo $'\\''`;
    expect(old(bypass)).toBe(false);
    expect(sb.run(bypass).canary).toContain('canary');
  });
});
