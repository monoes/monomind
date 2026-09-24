import { readFileSync, } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, } from 'vitest';
import { redactSecrets as redactSecretsTs } from '../../src/utils/redaction.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const _custom = { name: 'custom', baseUrl: 'http://127.0.0.1:3000', model: 'jev-latest' };
const _hosted = { name: 'typesafe', baseUrl: 'https://api.typesafe.ai', apiKey: 'ts-key', model: 'jev-latest' };
const localEnv = { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const choice = (id: string, confidence: number, probabilities?: Record<string, number>) => ({
  type: 'choice',
  choice: id,
  confidence,
  probabilities: probabilities ?? { [id]: confidence },
});

/** Serves queued responses (or throws queued errors) in order; records calls. */
function fakeFetch(...queue: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Never answers; rejects when the request's signal aborts. */
function _hangingFetch() {
  const calls: string[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push(url);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const agents = [
  { id: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
  { id: 'tester', name: 'tester', category: 'core', description: 'Writes unit tests and coverage' },
  { id: 'security-engineer', name: 'Security Engineer', category: 'security', description: 'Security audits' },
];
const _skills = [
  { id: 'security-review', invoke: 'Skill("security-review")', description: 'Security review of changes' },
  { id: 'monodesign', invoke: '/monodesign', description: 'Frontend design' },
];

describe('redaction', () => {
  it('uses exactly the maintained redactor patterns (no drift from redaction.ts)', () => {
    const src = readFileSync(new URL('../../src/utils/redaction.ts', import.meta.url), 'utf-8');
    const start = src.indexOf('const SECRET_PATTERNS: RegExp[] = [');
    const block = src.slice(start, src.indexOf('];', start));
    const ts = block
      .split('\n')
      .slice(1)
      .map((l) => l.replace(/,\s*(\/\/.*)?$/, '').trim())
      .filter((l) => l.startsWith('/') && !l.startsWith('//')); // regex literals, not comment lines
    expect(ts.length).toBeGreaterThan(10);
    expect(jp.SECRET_PATTERNS.map(String)).toEqual(ts);
  });

  it('matches redaction.ts on every credential family, and masks before sending', async () => {
    // Built at runtime so no literal credential shape appears in the repo.
    const r = (n: number) => 'a1B2'.repeat(Math.ceil(n / 4)).slice(0, n);
    const fixtures = [
      `${'sk'}-ant-${r(24)}`,
      `${'github'}_pat_${r(30)}`,
      `${'gh'}p_${r(36)}`,
      `Authorization: ${'Bearer'} ${r(24)}`,
      `{"${'api'}Key": "${r(16)}"}`,
      `${'xox'}b-${r(20)}`,
      `postgres://u${'ser'}:${r(12)}@db.internal/x`,
      `${'AWS'}_SECRET_ACCESS_KEY=${r(40)}`,
      `${'aws'}_secret_access_key = ${r(40)}`,
      `${'AI'}za${r(35)}`,
      `Authorization: ${'Basic'} ${r(20)}==`,
      `DB_${'PASS'}=hunter2`,
      `${'PASSWORD'}=short`,
      `${'hf'}_${r(34)}`,
      `${'xapp'}-1-A${r(10)}-${r(24)}`,
      `${'rk'}_live_${r(24)}`,
      `${'ya29'}.${r(40)}`,
      `-----BEGIN ENCRYPTED ${'PRIVATE'} KEY-----\n${r(64)}\n-----END ENCRYPTED ${'PRIVATE'} KEY-----`,
      `-----BEGIN PGP ${'PRIVATE'} KEY BLOCK-----\nComment: gpg-agent\n\n${r(64)}\n-----END PGP ${'PRIVATE'} KEY BLOCK-----`,
    ];
    for (const f of fixtures) {
      expect(jp.redactSecrets(f)).toBe(redactSecretsTs(f));
      expect(jp.redactSecrets(f)).toContain('[redacted]');
    }
    for (const s of ['basic setup for the login page', 'PASS_RATE=0.9', 'the password field']) {
      expect(jp.redactSecrets(s)).toBe(s);
      expect(redactSecretsTs(s)).toBe(s);
    }
    const f = fakeFetch(json({ answers: { agent: choice('coder', 0.9) } }));
    await jp.pick(`fix login, key ${fixtures[0]}`, { agents }, { env: localEnv, fetchImpl: f.impl });
    const sent = JSON.parse(String(f.calls[0].init.body)).state;
    expect(sent).not.toContain(fixtures[0]);
    expect(sent).toContain('[redacted]');
  });

  it('masks candidate descriptions before sending', async () => {
    const key = `${'sk'}-ant-${'a1B2'.repeat(6)}`;
    const f = fakeFetch(json({ answers: { agent: choice('coder', 0.9) } }));
    const leaky = [agents[0], { ...agents[1], description: `Runs tests with key ${key}` }];
    await jp.pick('write tests', { agents: leaky }, { env: localEnv, fetchImpl: f.impl });
    const criteria = JSON.parse(String(f.calls[0].init.body)).questions.agent.criteria;
    expect(JSON.stringify(criteria)).not.toContain(key);
    expect(criteria.tester).toContain('[redacted]');
  });

  it('redacts 200 KB of adversarial text in linear time (TS and CJS)', () => {
    const rep = (s: string) => s.repeat(Math.ceil(200_000 / s.length)).slice(0, 200_000);
    const inputs = [
      rep('A'),
      rep('a://'),
      rep('a://b:'),
      `a://${rep('b:')}`,
      rep('eyJ'),
      rep(`-----BEGIN RSA ${'PRIVATE'} KEY-----`),
      Buffer.alloc(150_000, 7).toString('base64'),
    ];
    for (const redact of [jp.redactSecrets, redactSecretsTs]) {
      for (const text of inputs) {
        const started = performance.now();
        redact(text);
        // The quadratic patterns took 4.7-19 s on 100-200 KB; 1 s leaves room
        // for a slow CI runner and still catches any super-linear regression.
        expect(performance.now() - started).toBeLessThan(1000);
      }
      expect(redact('x postgres://u:p@h y')).toBe('x [redacted] y');
    }
  });

  it('caps the prompt and descriptions before redacting them', async () => {
    const b64 = Buffer.alloc(150_000, 7).toString('base64');
    const blob = `Please decode this:\n${b64.replace(/.{76}/g, '$&\n')}`; // MIME-wrapped, as pasted
    const f = fakeFetch(json({ answers: { agent: choice('coder', 0.9) } }));
    const started = performance.now();
    await jp.pick(blob, { agents: [agents[0], { ...agents[1], description: blob }] }, { env: localEnv, fetchImpl: f.impl });
    expect(performance.now() - started).toBeLessThan(1000);
    const sent = JSON.parse(String(f.calls[0].init.body));
    expect(sent.state).toBe(blob.slice(0, 8000));
    expect(sent.questions.agent.criteria.tester).toHaveLength(160);
  });

  // Redacting earlier secrets shrinks them to "[redacted]", which pulls a secret
  // cut at the window edge (too short to match now) into the 8000 chars sent.
  describe('a secret straddling the redaction window edge', () => {
    const jwt = `${'ey'}J${'h'.repeat(1200)}.${'p'.repeat(1200)}.${'s'.repeat(1200)}`;
    const bearers = (len: number) => {
      let pad = 'Why does this request fail?\n';
      while (pad.length < len) pad += `Authorization: ${'Bearer'} ${jwt}\n`;
      return pad.slice(0, len);
    };
    const pem = (body: string) =>
      `-----BEGIN RSA ${'PRIVATE'} KEY-----\n${body.replace(/.{64}/g, '$&\n')}\n-----END RSA ${'PRIVATE'} KEY-----\n`;
    const sentState = async (task: string) => {
      const f = fakeFetch(json({ answers: { agent: choice('coder', 0.9) } }));
      await jp.pick(task, { agents }, { env: localEnv, fetchImpl: f.impl });
      return f.calls.length ? String(JSON.parse(String(f.calls[0].init.body)).state) : '';
    };

    it('does not send the cut-off head of a fixed-length secret', async () => {
      const secret = ['wJalrXUtnFEMI7K9', 'MDENGbPxRfiCY3kQzT8vLp2A'].join(''); // 40 chars
      const task = `${bearers(16_001 - 63)}\n${'aws'}_secret_access_key=${secret}`;
      expect(task.indexOf(secret)).toBeLessThan(16_000);
      expect(task.indexOf(secret) + secret.length).toBeGreaterThan(16_000);
      expect(await sentState(task)).not.toContain(secret.slice(0, 20));
    });

    it('does not send the body of a private key cut at the window edge', async () => {
      const body = (tag: string, n: number) => `MII${tag}${'Qx7'.repeat(n)}`.slice(0, n);
      let task = '';
      for (const tag of ['AAA', 'BBB', 'CCC']) task += `key ${tag}:\n${pem(body(tag, 3300))}`;
      task += 'filler text '.repeat(Math.ceil((13_500 - task.length) / 12));
      task = `${task.slice(0, 13_500)}\n${pem(body('DDD', 4000))}`;
      const state = await sentState(task);
      expect(state).toContain('[redacted]');
      expect(state).not.toContain('MIIDDD');
      expect(state).not.toMatch(/Qx7Qx7Qx7/);
    });

    // The window cuts the END line itself: `-----END RSA ` alone does not close the block.
    const endCut = (crlf: boolean, into: number) => {
      const key = pem(`MIIEEE${'Rz4'.repeat(1300)}`);
      const block = crlf ? key.replace(/\n/g, '\r\n') : key;
      const at = block.indexOf('-----END ') + into;
      const line = `Authorization: ${'Bearer'} ${jwt}\n`;
      let pad = 'Why does this request fail?\n';
      while (pad.length + line.length < 16_000 - at) pad += line;
      return `${pad}${' '.repeat(16_000 - at - pad.length)}${block}more text after`;
    };
    it.each([
      ['inside "RSA"', false, 11],
      ['inside "KEY-----"', false, 27],
      ['inside "RSA", CRLF line ends', true, 11],
    ])('does not send a private key whose END line is cut %s', async (_label, crlf, into) => {
      const task = endCut(crlf, into);
      expect(task.slice(0, 16_000)).toMatch(/-----END [^\r\n]*$/);
      const state = await sentState(task);
      expect(state).toContain('[redacted]');
      expect(state).not.toContain('MIIEEE');
      expect(state).not.toMatch(/Rz4Rz4Rz4/);
      const f = fakeFetch(json({ answers: { agent: choice('coder', 0.9) } }));
      await jp.pick('route this', { agents: [agents[0], { ...agents[1], description: task }] }, { env: localEnv, fetchImpl: f.impl });
      const criteria = JSON.parse(String(f.calls[0].init.body)).questions.agent.criteria;
      expect(criteria[agents[1].id]).not.toMatch(/MIIEEE|Rz4Rz4/);
    });

    it('trims the window tail in linear time', () => {
      const { redactHead } = require('../../.claude/helpers/redact-secrets.cjs');
      for (const text of [`${'a'.repeat(15_990)} b${'c'.repeat(20_000)}`, `${'x'.repeat(200_000)}`]) {
        const started = performance.now();
        redactHead(text);
        expect(performance.now() - started).toBeLessThan(50);
      }
    });
  });
});
