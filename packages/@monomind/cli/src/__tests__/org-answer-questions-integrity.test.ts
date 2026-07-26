// Regression: `org answer` must never overwrite questions.json from an empty
// list produced by a FAILED re-read (data loss). See answerAction's offline path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerAction } from '../commands/org-observe.js';
import type { CommandContext } from '../types.js';

const ORG = 'testorg';

const question = (id: string, answer: string | null = null) => ({
  questionId: id, role: 'coder', question: `q ${id}`, ts: 1, answer, answeredAt: null,
});

let cwd: string;
let brokerDir: string;
let qPath: string;

const ctx = (args: string[]): CommandContext => ({ args, flags: { _: [] }, cwd, interactive: false });

const writeQuestions = (qs: unknown[]): void => {
  writeFileSync(qPath, JSON.stringify({ questions: qs }, null, 2));
};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'org-answer-'));
  brokerDir = join(cwd, 'broker');
  mkdirSync(brokerDir, { recursive: true });
  process.env.MONOMIND_ORGRT_BROKER_DIR = brokerDir;
  mkdirSync(join(cwd, '.monomind/orgs', ORG), { recursive: true });
  qPath = join(cwd, '.monomind/orgs', ORG, 'questions.json');
  writeQuestions([question('q1'), question('q2'), question('q3')]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MONOMIND_ORGRT_BROKER_DIR;
  rmSync(cwd, { recursive: true, force: true });
});

describe('org answer — questions.json integrity', () => {
  it('merges the answer and preserves sibling questions', async () => {
    const res = await answerAction(ctx([ORG, 'q2', 'the', 'answer']), ORG);
    expect(res.success).toBe(true);
    const after = JSON.parse(readFileSync(qPath, 'utf8')) as { questions: Array<{ questionId: string; answer: string | null }> };
    expect(after.questions.map(q => q.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(after.questions.find(q => q.questionId === 'q2')?.answer).toBe('the answer');
    expect(after.questions.find(q => q.questionId === 'q1')?.answer).toBeNull();
    // message queued for the offline org
    expect(readFileSync(join(cwd, '.monomind/orgs', ORG, 'inbox.jsonl'), 'utf8')).toContain('answer:q2');
  });

  it('aborts without truncating questions.json when the pre-write re-read fails', async () => {
    // Live-delivery attempt widens the window between the first read and the
    // pre-write re-read; corrupt the file inside it, exactly as a partial
    // daemon write would.
    const { registerOrg } = await import('../orgrt/broker.js');
    registerOrg(ORG, 'http://127.0.0.1:59999', brokerDir);
    const corrupt = '{"questions": [{"questionId": "q1"';
    vi.stubGlobal('fetch', async () => {
      writeFileSync(qPath, corrupt);
      throw new Error('connection refused');
    });

    const res = await answerAction(ctx([ORG, 'q2', 'the', 'answer']), ORG);

    expect(res.success).toBe(false);
    // The damaged file must be left exactly as found — not replaced by a
    // single-question file that destroys q1 and q3.
    expect(readFileSync(qPath, 'utf8')).toBe(corrupt);
  });
});
