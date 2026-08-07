// packages/@monomind/cli/src/orgrt/questions.ts
// Extracted from daemon.ts — ask_human / answerQuestion flow.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { queueMessage } from './inbox.js';
import { ORG_DIR } from './types.js';
import type { OrgDaemon } from './daemon.js';

export function questionsPath(root: string, org: string): string {
  return join(root, ORG_DIR, org, 'questions.json');
}

export function readQuestions(root: string, org: string): { questions: Array<{ questionId: string; role: string; question: string; ts: number; answer: string | null; answeredAt: number | null }> } {
  try { return JSON.parse(readFileSync(questionsPath(root, org), 'utf8')); } catch { return { questions: [] }; }
}

export function writeQuestions(root: string, org: string, data: ReturnType<typeof readQuestions>): void {
  const dest = questionsPath(root, org);
  mkdirSync(join(root, ORG_DIR, org), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, dest);
}

/** Serialize question mutations per org (same pattern as withApprovalLock).
 *  askHuman and answerQuestion race on questions.json without this. */
function withQuestionsLock<T>(daemon: OrgDaemon, org: string, fn: () => Promise<T>): Promise<T> {
  const prev = daemon.questionsLocks.get(org) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  daemon.questionsLocks.set(org, next.catch(() => { /* slot stays usable for the next caller */ }));
  return next;
}

/** Agent-initiated human question (ask_human tool). Persists to questions.json (survives
 *  process/dashboard restarts) and emits a 'question' BusEvent so the dashboard's SSE
 *  stream and global inbox pick it up in real time. Returns a receipt string for the tool call.
 *  Serialized per-org via withQuestionsLock() (same TOCTOU pattern as approvals). */
export function askHuman(daemon: OrgDaemon, org: string, role: string, question: string): Promise<string> {
  return withQuestionsLock(daemon, org, async () => {
    const running = daemon.orgs.get(org);
    const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = readQuestions(daemon.root, org);
    data.questions.push({ questionId, role, question, ts: Date.now(), answer: null, answeredAt: null });
    writeQuestions(daemon.root, org, data);
    running?.bus.emit({ type: 'question', from: role, data: { questionId, question } });
    return `Question recorded (id ${questionId}) — a human will answer it; you'll receive the answer as a new message.`;
  });
}

/** Delivers a human's answer to a pending ask_human question. If the org is still
 *  running, pushes straight into the role's live mailbox (picked up on its very next
 *  generator tick — see Mailbox.stream()). If the org has since stopped, queues the
 *  answer via the same offline fallback deliver()/receiveRemote() already use
 *  (inbox.ts + autoWake) and it's delivered when the org next starts.
 *
 *  PERSIST-AFTER-DELIVERY: questions.json is only marked answered once delivery has
 *  actually happened (mailbox push, or the message landing in inbox.jsonl). Marking it
 *  first meant a rejected delivery — unknown role, mailbox closed mid-shutdown, a
 *  queueMessage that threw on a full/read-only disk — left the question recorded as
 *  answered while nobody ever received the answer, and the `already answered` guard
 *  then refused every retry. The answer was simply gone. The inverse failure (crash
 *  between delivery and the write) merely re-shows the question as pending, which a
 *  human can act on; a silently swallowed answer is not recoverable. */
export function answerQuestion(daemon: OrgDaemon, org: string, role: string, questionId: string, answer: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return withQuestionsLock(daemon, org, async () => {
    const data = readQuestions(daemon.root, org);
    const idx = data.questions.findIndex(q => q.questionId === questionId);
    if (idx === -1) return { ok: false, error: `question "${questionId}" not found for org "${org}"` };
    if (data.questions[idx].answer !== null) return { ok: false, error: `question "${questionId}" already answered` };
    const question = data.questions[idx].question;
    // Applied to questions.json ONLY after the delivery below succeeds.
    const markAnswered = (): void => {
      // Re-read so a question the daemon appended (or answered) meanwhile isn't
      // clobbered by this stale snapshot — merge by questionId, never replace.
      const fresh = readQuestions(daemon.root, org);
      const fIdx = fresh.questions.findIndex(q => q.questionId === questionId);
      if (fIdx === -1) fresh.questions.push({ ...data.questions[idx], answer, answeredAt: Date.now() });
      else fresh.questions[fIdx] = { ...fresh.questions[fIdx], answer, answeredAt: Date.now() };
      writeQuestions(daemon.root, org, fresh);
    };

    const running = daemon.orgs.get(org);
    if (running) {
      // Org IS running — deliver or report a real error, but never fall through to the
      // offline queue+autoWake path below: autoWake() no-ops when this.orgs already has
      // the org (see its own guard), so a role-specific delivery failure here (mailbox
      // closed, role unknown) would otherwise queue the answer forever with no real error
      // and no delivery. Mirrors deliver()'s existing "shutting down" error for the same
      // mid-shutdown-mailbox-closed race.
      // Spawn a lazily-deferred role before giving up on it. Roles are no longer
      // all spawned at boot, so `agents` legitimately lacks a role that simply
      // has not been needed yet — and rejecting on that dropped the human's
      // answer with "role not found" for a role that exists and is about to
      // run. deliver() does the same lookup; a human answer must not be the one
      // delivery path that cannot wake a role.
      if (!running.agents.has(role) && running.pendingRoles?.has(role)) {
        const pending = running.pendingRoles.get(role)!;
        running.pendingRoles.delete(role);
        running.spawnRole?.(pending);
      }
      const agent = running.agents.get(role);
      if (!agent) return { ok: false, error: `role "${role}" not found in org "${org}"` };
      if (agent.mailbox.isClosed) return { ok: false, error: `role "${role}" in org "${org}" is shutting down — answer not delivered` };
      try {
        agent.mailbox.push(`[answer from human] question: ${question}\n\nanswer: ${answer}`);
      } catch (err) {
        return { ok: false, error: `delivery to "${role}" in org "${org}" failed — answer not recorded (${err instanceof Error ? err.message : String(err)})` };
      }
      markAnswered();
      running.bus.emit({ type: 'status', from: role, msg: 'question answered', data: { questionId } });
      return { ok: true };
    }
    // Org not running at all — queue for delivery on next start, matching deliver()'s
    // existing offline fallback exactly (inbox.ts + autoWake).
    if (!daemon.hasOrgDef(org)) return { ok: false, error: `org "${org}" not found (no saved definition)` };
    const queued = queueMessage(daemon.root, org, {
      fromQualified: 'human', toRole: role,
      subject: `answer:${questionId}`,
      body: `question: ${question}\n\nanswer: ${answer}`,
      ts: Date.now(),
    });
    if (!queued) {
      return { ok: false, error: `could not queue answer for org "${org}" — answer not recorded (disk full or permissions)` };
    }
    markAnswered();
    daemon.autoWake(org);
    return { ok: true };
  });
}
