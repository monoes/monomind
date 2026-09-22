/**
 * ADR-O001 D6 — the only input an artifact-only reviewer receives.
 *
 * Built by the runtime from artifacts, never by an agent: the issue text, the
 * runtime's own diff at the evidence sha, and the acceptance commands with
 * their exit codes and output. What it leaves out is the point — the doer's
 * result prose, its reasoning, the thread, earlier rounds and the attempt
 * count. On the measured run a reviewer that had watched the work approved
 * shas the verifier then failed, three times out of three.
 */
import { execFileSync } from 'node:child_process';
import type { TaskEvidence } from './completion-gate.js';

/** Per-check output kept on the task row (and so in the packet). */
export const EVIDENCE_OUTPUT_CAP = 4_000;
/** The diff's share of a packet; past this the reviewer is told how to get it all. */
export const DIFF_CAP = 60_000;

/** Keep the head and tail of `text`, marking what was cut — failures tend to
 *  sit at the end of a log, context at the start. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… [${text.length - max} chars truncated] …\n${text.slice(-half)}`;
}

export type ReviewDiff = { ok: true; text: string } | { ok: false; reason: string };

/** A ref or sha safe to hand git as a revision (no options, no ranges). */
const REV = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** `git diff <base>...<sha>` in `cwd`, computed by the runtime. */
export function reviewDiff(cwd: string, base: string, sha: string): ReviewDiff {
  if (!REV.test(base) || !REV.test(sha))
    return { ok: false, reason: 'base or sha is not a plain git revision' };
  try {
    const text = execFileSync('git', ['diff', '--no-color', `${base}...${sha}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, text };
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr?.trim() || (err as Error).message;
    return { ok: false, reason: msg.split('\n')[0] ?? 'git diff failed' };
  }
}

export interface ReviewPacketInput {
  taskId: string;
  /** The task's own text — the issue, as the org filed it. */
  issue: string;
  evidence: TaskEvidence;
  diff: ReviewDiff;
  /** Who the verdict goes to. */
  replyTo: string;
  base?: string;
}

export function buildReviewPacket(p: ReviewPacketInput): string {
  const checks = p.evidence.checks.length
    ? p.evidence.checks
        .map((c) => {
          const out = c.output
            ? `\n${capText(c.output, EVIDENCE_OUTPUT_CAP)}`
            : '\n(no output recorded)';
          const expected = c.expectExit !== undefined ? ` (expected ${c.expectExit})` : '';
          return `$ ${c.command}\n→ exit ${c.exitCode}${expected}${out}`;
        })
        .join('\n\n')
    : '(no acceptance commands were submitted)';
  const diff = p.diff.ok
    ? capText(p.diff.text, DIFF_CAP) || '(empty diff)'
    : `(diff unavailable: ${p.diff.reason})`;
  return [
    `[review:${p.taskId}] Review request — artifacts only.`,
    `You are seeing only what the runtime could check: the issue, the diff at ${p.evidence.headSha}${p.base ? ` against ${p.base}` : ''}, and the acceptance commands with their real output. Judge the artifact, not anyone's account of it. Read the code in the repository if the diff is not enough.`,
    `## Issue\n${p.issue}`,
    `## Acceptance commands (as run by the assignee at ${p.evidence.headSha})\n${checks}`,
    `## Diff\n${diff}`,
    `## Your verdict\nSend it with org_send to "${p.replyTo}": first line \`VERDICT: APPROVE|REJECT ${p.evidence.headSha}\`, then numbered findings with file:line.`,
  ].join('\n\n');
}
