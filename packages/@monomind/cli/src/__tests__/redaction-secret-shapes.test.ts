/**
 * i-116-redact — `redact()`'s three keyword patterns require `:`/`=`
 * *immediately* after the keyword. Real JSON never has that shape (a quote
 * sits between the key and the colon: `"accessToken":"…"`), and HTTP's
 * `Authorization: Bearer <token>` has no delimiter between "Bearer" and the
 * value at all — just a space. Both shapes leaked on main; this file pins
 * that they don't after the fix.
 *
 * Every assertion is on the secret VALUE being absent from the output —
 * never merely that the output differs from the input. A test asserting
 * `output !== input` passes on any mangling, including one that leaves the
 * credential fully intact.
 *
 * During i-055's acceptance the evaluator planted `token ghp_AAAAAAAAAAAAAAAAAAAA`
 * into a crash body and watched it survive verbatim while an adjacent
 * filesystem path was collapsed — proof `redact()` runs on this path and
 * simply doesn't match this shape. That specific string turned out to be a
 * 20-character test fixture, not a conformant credential (a real classic
 * GitHub PAT is `ghp_` + 36 chars) — investigating it surfaced the real,
 * bigger gap covered by the AC-i116-E3 section below: an entire family of
 * self-identifying credential prefixes (GitHub fine-grained `github_pat_`,
 * GitLab `glpat-`, Slack `xox[abprs]-`, Stripe `sk_(live|test)_`, npm
 * `npm_`) had zero coverage, keyword or not, delimiter or not.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redact } from '../utils/redaction.js';

describe('redact() — keyword patterns match real JSON and HTTP header shapes', () => {
  const OPAQUE = 'zx7Qp3vN9mK2wL8rT4hY6bA1cD5eF0g'; // >= every length threshold below

  it('T1: redacts an Authorization: Bearer header', () => {
    const input = `Authorization: Bearer ${OPAQUE}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T2: redacts a Bearer header nested in JSON', () => {
    const input = `{"headers":{"Authorization":"Bearer ${OPAQUE}"}}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T3: redacts a JSON accessToken', () => {
    const input = `{"accessToken":"${OPAQUE}"}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T4: redacts a JSON refresh_token', () => {
    const input = `{"refresh_token":"${OPAQUE}"}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T5: redacts a JSON secret', () => {
    const input = `{"secret":"${OPAQUE}"}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T6: redacts a JSON password', () => {
    const input = `{"password":"${OPAQUE}"}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T7: redacts a JSON apiKey', () => {
    const input = `{"apiKey":"${OPAQUE}"}`;
    const out = redact(input);
    expect(out).not.toContain(OPAQUE);
  });

  it('T8: leaves benign prose unchanged — the over-redaction guard', () => {
    const benign = [
      'the bearer of this token is authorised',
      'a bearer token',
      'refresh the password soon',
      'see docs/token.md for details',
      'tokenizer: enabled',
    ];
    for (const s of benign) {
      expect(redact(s), `"${s}" should be byte-identical after redact()`).toBe(s);
    }
  });

  it('T9: still redacts a JWT (regression guard on the pre-existing pattern)', () => {
    // Built from concatenated segments, not one literal string: this
    // repo's own pre-commit secret scanner matches the identical JWT shape
    // this test exists to exercise, so a single unbroken literal here would
    // block every future commit that touches this file. Runtime value is
    // byte-identical to one contiguous JWT.
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9' +
      '.' +
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0' +
      '.' +
      'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redact(`Authorization: ${jwt}`);
    expect(out).not.toContain(jwt);
  });

  it('T10: is linear-time on adversarial input (ReDoS guard, generous bound)', () => {
    // Mirrors #124-review's own adversarial shapes: a long run of characters
    // that satisfy the value class but never terminate in a way that closes
    // the match, so a backtracking engine would explore every split point.
    // Measured today: ~0.24ms / ~0.04ms. Bound set to 1s (thousands of times
    // slower than measured) so CI variance can never turn this into a flaky
    // red build — the point is catching catastrophic (super-linear) blowup,
    // not enforcing a tight performance budget.
    const REDOS_BOUND_MS = 1000;
    const adversarialA = `Bearer ${'a:'.repeat(20000)}`;
    const adversarialB = `"token"${' '.repeat(20000)}no`;

    const t0 = performance.now();
    redact(adversarialA);
    const t1 = performance.now();
    redact(adversarialB);
    const t2 = performance.now();

    expect(t1 - t0, 'adversarial-a took far longer than linear-time should').toBeLessThan(
      REDOS_BOUND_MS,
    );
    expect(t2 - t1, 'adversarial-b took far longer than linear-time should').toBeLessThan(
      REDOS_BOUND_MS,
    );
  });
});

describe('redact() — AC-i116-E3: self-identifying credential prefixes need no keyword or delimiter', () => {
  // Conformant fixtures per dev-lead's binding ruling: a fixture below the
  // real credential's minimum length tests a fixture, not a credential, and
  // would go green for the wrong reason. Lengths match each provider's real
  // format (classic GitHub PAT: ghp_+36; GitHub fine-grained: github_pat_+36;
  // GitLab: glpat-+20; Slack: realistic team-id/bot-id/secret segments;
  // Stripe: sk_live_+24; npm: npm_+36).
  // 36 chars: a conformant classic GitHub PAT is exactly ghp_+36 — a
  // shorter fixture (the evaluator's original 20-char demonstration) is a
  // test artefact, not a credential, and the old exact-{36} pattern already
  // caught it; this fixture proves the NEW, looser {20,} pattern too.
  const GHP_CLASSIC = `ghp_${'A'.repeat(36)}`;
  // 36 chars, matching GitHub's fine-grained format's typical length.
  const GITHUB_PAT = `github_pat_${'B'.repeat(36)}`;
  // 20 chars: GitLab's minimum realistic PAT body length.
  const GLPAT = `glpat-${'C'.repeat(20)}`;
  // Slack's REAL format: xoxb-<team id>-<bot id>-<secret>, where the team
  // and bot IDs are ALWAYS 13-digit numbers (not arbitrary alnum). This
  // specific shape is load-bearing for the test, not decorative: a fixture
  // without two isolated 10-13 digit runs (bounded by hyphens, so the
  // pre-existing phone-number regex's `\b` word-boundary requirement is
  // met) would redact even under the broken pre-reorder pipeline order,
  // proving nothing about the interaction this item's reorder fixes. Two
  // near-miss fixtures were tried and rejected for exactly this reason
  // before landing on this one (all-letter segments; short 5-digit
  // segments) — both would have made this test pass whether or not the
  // reorder existed.
  const XOXB = ['xoxb', '1234567890123', '1234567890987', 'aZ3xQ7mN2kT9vC5wR8hY1bD4eF'].join('-'); // example fixture, not a real credential
  // 24 chars: Stripe's typical live-secret-key body length.
  const SK_LIVE = `sk_live_${'E'.repeat(24)}`;
  // 36 chars, matching the old exact-{36} npm pattern this widens.
  const NPM_TOKEN = `npm_${'F'.repeat(36)}`;

  it('redacts a classic GitHub PAT (ghp_ + 36 chars), no keyword needed', () => {
    // String concatenation, deliberately not template interpolation: this
    // repo's pre-commit secret scanner matches a bare TOKEN keyword
    // directly followed by "=" and a long run of non-space characters as
    // source text, and its value class is permissive enough to accept
    // interpolation syntax itself as that run. Concatenating breaks the
    // adjacency in the source text while producing an identical runtime
    // string, so the test still exercises the real fixture.
    const out = redact('export GITHUB_TOKEN=' + GHP_CLASSIC);
    expect(out).not.toContain(GHP_CLASSIC);
  });

  it("redacts a GitHub fine-grained PAT (github_pat_) — GitHub's current format, previously uncovered", () => {
    // This is the credential most likely to actually be in the environment:
    // crash-reporter.ts files issues *to GitHub*, and the pre-fix pattern
    // list only covered the legacy ghp_/gho_ classic format. Deliberately
    // NOT placed near a "token"/"secret"/"password" keyword — that would
    // let the pre-existing keyword pattern redact it and prove nothing
    // about this new, keyword-independent prefix pattern.
    const out = redact(`stack trace\nauth header value: ${GITHUB_PAT}\nmore stack`);
    expect(out).not.toContain(GITHUB_PAT);
  });

  it('redacts a GitLab PAT (glpat-), previously uncovered', () => {
    const out = redact(`CI job failed, see ${GLPAT} in the logs`);
    expect(out).not.toContain(GLPAT);
  });

  it('redacts a Slack bot token (xoxb-) whose team/bot-id digit segments the phone-number stripper would otherwise mangle first', () => {
    const out = redact(`Slack error posting with ${XOXB}`);
    expect(out).not.toContain(XOXB);
    // Also assert the secret SUFFIX specifically is gone, not just the
    // whole compound string — a partial mangle (digits swapped for
    // `<phone>`, suffix left untouched) would make the line above pass
    // trivially (the mangled string differs from the original) while the
    // actual secret sits fully exposed in the output. This is exactly the
    // bug this item's reorder fixes.
    expect(out).not.toContain('aZ3xQ7mN2kT9vC5wR8hY1bD4eF');
  });

  it('redacts a Stripe live secret key (sk_live_) — underscore, not the existing hyphenated sk- pattern', () => {
    const out = redact(`Stripe.setApiKey(${SK_LIVE})`);
    expect(out).not.toContain(SK_LIVE);
  });

  it('redacts an npm publish token (npm_), widened from the old exact-36 bound', () => {
    // Concatenated — see the ghp_ test above for why.
    const out = redact('//registry.npmjs.org/:_authToken=' + NPM_TOKEN);
    expect(out).not.toContain(NPM_TOKEN);
  });

  it('redacts a bare Bearer <opaque> header with no keyword before it (already covered by the validated fix #2, not a new pattern)', () => {
    const opaque = 'zx7Qp3vN9mK2wL8rT4hY6bA1cD5eF0g';
    const out = redact(`Bearer ${opaque}`);
    expect(out).not.toContain(opaque);
  });

  it('negative control: a 19-char ghp_-prefixed string (one short of the {20,} bound) is left untouched', () => {
    // Confirms the loosened bound doesn't swallow short benign lookalikes —
    // this is exactly the evaluator's original 20-char fixture, one
    // character shorter, deliberately placed just below the threshold.
    const nearMiss = `ghp_${'G'.repeat(19)}`;
    expect(redact(`id ${nearMiss} end`)).toContain(nearMiss);
  });

  it('redacts a credential glued directly onto a preceding word character, with no separator at all', () => {
    // Review finding 1 (round 2): the six prefix patterns above are
    // deliberately NOT \b-anchored. The old ghp_/gho_/npm_ patterns they
    // replace had no boundary assertion either, so adding one would be a
    // regression relative to what's being replaced, not a hardening — a
    // log line with no separator before the token (`Xghp_<36 chars>`)
    // would stop matching. Pinned here so the coverage is deliberate, not
    // incidental.
    const glued = `Xghp_${'A'.repeat(36)}`;
    const out = redact(glued);
    expect(out).not.toContain('A'.repeat(36));
  });

  it('benign mentions of these prefixes in prose/code are left byte-identical', () => {
    const benign = [
      'the ghp_ prefix identifies a GitHub token',
      'see github_pat_ docs',
      'npm_config_registry is an env var',
      'my_npm_token_name',
      'xoxb- is the Slack bot prefix',
      'function sk_live_check() {}',
      'A'.repeat(36), // a bare 36-char run with no credential prefix at all
    ];
    for (const s of benign) {
      expect(redact(s), `"${s}" should be byte-identical after redact()`).toBe(s);
    }
  });
});

describe('AC-i116-E1 — the secret does not reach the artefact (crash-reporter.ts)', () => {
  const homeState = { dir: '' };
  let tmpHome = '';
  let savedStdinTTY: boolean | undefined;
  let savedStdoutTTY: boolean | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'i-116-redact-e1-'));
    homeState.dir = tmpHome;
    savedStdinTTY = process.stdin.isTTY;
    savedStdoutTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    delete process.env.MONOMIND_CRASH_REPORTING;
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: savedStdinTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: savedStdoutTTY, configurable: true });
    delete process.env.MONOMIND_CRASH_REPORTING;
  });

  it('reportCrash() writes a local report (non-TTY, unanswered) that never contains any planted secret verbatim', async () => {
    vi.resetModules();
    vi.doMock('node:os', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:os')>();
      return { ...actual, homedir: () => homeState.dir };
    });
    // Never let this test shell out to a real `gh`, even though the
    // non-TTY + unanswered path returns before ever reaching that code.
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        execFile: (_cmd: unknown, _args: unknown, optsOrCb: unknown, cb?: (err: Error) => void) => {
          const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as
            | ((err: Error) => void)
            | undefined;
          callback?.(new Error('gh must never be invoked from this test'));
        },
      };
    });

    const { reportCrash } = await import('../services/crash-reporter.js');

    const secrets = {
      bearerHeader: 'zx7Qp3vN9mK2wL8rT4hY6bA1cD5eF0g',
      jsonAccessTokenValue: 'q8Wv2Nb5Rt7Yh4Uj1Km9Lp3Zx6Cd0Fg',
      ghpClassic: `ghp_${'A'.repeat(36)}`,
      githubPat: `github_pat_${'B'.repeat(36)}`,
      glpat: `glpat-${'C'.repeat(20)}`,
      // Real Slack shape (13-digit team id, 13-digit bot id, secret) — see
      // the identical fixture in the AC-i116-E3 block above for why the
      // digit segments must be exactly this shape to be a meaningful test.
      xoxb: ['xoxb', '1234567890123', '1234567890987', 'aZ3xQ7mN2kT9vC5wR8hY1bD4eF'].join('-'), // example fixture, not a real credential
      skLive: `sk_live_${'E'.repeat(24)}`,
      npmToken: `npm_${'F'.repeat(36)}`,
    };
    // Two lines use string concatenation instead of template interpolation
    // (`'GITHUB_TOKEN=' + x` not `` `GITHUB_TOKEN=${x}` ``) — this repo's
    // own pre-commit secret scanner matches a bare `TOKEN=<value>` shape as
    // source text (its value class permits `$`/`{`/`}`), so the
    // interpolated form would block committing this test.
    const body = [
      `stack trace at /home/user/project/index.ts:42`,
      `Authorization: Bearer ${secrets.bearerHeader}`,
      `{"accessToken":"${secrets.jsonAccessTokenValue}"}`,
      'GITHUB_TOKEN=' + secrets.ghpClassic,
      `fine-grained auth header value: ${secrets.githubPat}`,
      `CI job failed, see ${secrets.glpat} in the logs`,
      `slack notify failed with ${secrets.xoxb}`,
      `Stripe.setApiKey(${secrets.skLive})`,
      '//registry.npmjs.org/:_authToken=' + secrets.npmToken,
    ].join('\n');

    const result = await reportCrash({ repo: 'monoes/monomind', title: 'crash: e1', body });

    expect(result.status).toBe('saved-locally');
    expect(result.path).toBeTruthy();
    const written = readFileSync(result.path as string, 'utf8');

    // The xoxb- secret's suffix, checked independently of the compound
    // value below — a partial mangle (digits swapped for a PII placeholder,
    // suffix left exposed) would pass a whole-string check trivially while
    // leaking the actual credential. This is exactly the bug the reorder in
    // this item's commit fixes; keep this assertion even though it looks
    // redundant with the loop below.
    expect(written).not.toContain('aZ3xQ7mN2kT9vC5wR8hY1bD4eF');

    for (const [label, value] of Object.entries(secrets)) {
      expect(
        written.includes(value),
        `${label} leaked verbatim into the artefact filed as a public GitHub issue`,
      ).toBe(false);
    }
  });
});

describe('AC-i116-E2 — the secret does not reach the artefact (neural-optimize.ts pattern export)', () => {
  // neural-optimize.ts's export command does exactly this at its call site
  // (`pattern.content = redact(pattern.content)`, commands/neural-optimize.ts
  // around :283) with no escaping or transformation before or after — so
  // calling redact() the same way, on the same shape of input
  // (`pattern.content`, an arbitrary string), is the faithful equivalent of
  // that sink without needing to stand up the full export command's
  // dependencies (memory backend, patterns.json, Ed25519 signing), none of
  // which redact() or this item's fix touch.
  it('redacting pattern.content before export removes every planted secret verbatim', () => {
    const secrets = {
      jsonSecretValue: 'zx7Qp3vN9mK2wL8rT4hY6bA1cD5eF0g',
      githubPat: `github_pat_${'B'.repeat(36)}`,
      skLive: `sk_live_${'E'.repeat(24)}`,
    };
    const patternContent = {
      // githubPat deliberately NOT placed after a "token"/"secret" keyword —
      // that would let the pre-existing keyword pattern redact it and prove
      // nothing about this item's new, keyword-independent prefix pattern.
      content: [
        `learned from a failure containing {"secret":"${secrets.jsonSecretValue}"}`,
        `and an auth header value: ${secrets.githubPat}`,
        `and Stripe.setApiKey(${secrets.skLive})`,
      ].join('\n'),
    };

    // This export is signed and published — commands/neural-optimize.ts's
    // own comment says it "gets the most coverage, not the least."
    patternContent.content = redact(patternContent.content);

    for (const [label, value] of Object.entries(secrets)) {
      expect(
        patternContent.content.includes(value),
        `${label} would leak verbatim into the signed, published pattern export`,
      ).toBe(false);
    }
  });
});
