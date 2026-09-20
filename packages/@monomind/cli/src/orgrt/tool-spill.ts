// packages/@monomind/cli/src/orgrt/tool-spill.ts
/**
 * ADR-O001 D2 — spill-and-reference for tool results.
 *
 * Measured on one real run: tool results are 76% of all context mass (Bash
 * 4,387 calls / 5.7M chars and Read 420 / 2.0M chars are 97% of that), while
 * inter-agent mail is 0.1%. A role holds ONE SDK session for its whole life
 * with no truncation anywhere in orgrt/, so every tool result it ever saw is
 * re-sent on every later turn — cost is roughly quadratic in turns.
 *
 * The mechanism already existed, pointed at the 0.1% channel: cross-org.ts's
 * `mailBody` writes an oversized mail body to `.mail/<id>.md` and leaves a
 * 1,024-char digest plus a path in context. This is the same shape, applied to
 * the channel that carries the mass — same "write in full FIRST, digest
 * second" ordering, same "on write failure deliver in full rather than lose
 * content" fallback.
 *
 * ── Threshold arithmetic (why 2,048) ──────────────────────────────────────
 * Result sizes: p50 451, p75 1,583, p90 3,506, p95 5,138, p99 11,739, max
 * 59,805, mean 1,370. It is a long tail of SMALL results, so the usual "only
 * spill the monsters" instinct recovers almost nothing:
 *
 *   threshold   spilled calls   net tool mass recovered
 *   11,739 (p99)      1.0%              21%
 *    5,138 (p95)      5.0%              37%
 *    4,096 (mail's)   8.2%              42%
 *    3,506 (p90)     10.0%              45%
 *    2,048           21.4%              52%      ← chosen
 *    1,536 (p75)     26.0%              52%
 *
 * Two constraints fix the choice. Below, a spilled result still costs its
 * digest (1,536) plus a reference line (~160) — about 1,700 chars — so any
 * threshold under ~1,700 ADDS mass instead of removing it; that is the floor.
 * Above, the curve is flat from 1,536 to ~3,000 and then falls away, so 2,048
 * (= 2× the mail digest) sits at the knee: it takes essentially all the
 * recoverable mass while leaving four fifths of all calls untouched, which is
 * what keeps a role able to do its job.
 *
 * ── Digest strategy ───────────────────────────────────────────────────────
 * Never a blind one-sided truncation. A Bash result puts what matters at the
 * END (assertion failures, the summary line, the exit status); a Read puts it
 * at the START. So the digest is always head + elision note + tail, with the
 * WEIGHT flipped by tool: 1/3 head + 2/3 tail for command-shaped tools
 * (the default, since Bash dominates), 2/3 head + 1/3 tail for file-shaped
 * ones.
 *
 * The response object's SHAPE is preserved — only its long string leaves are
 * digested, and the budget is water-filled across them smallest-first, so a
 * short `stderr` next to a huge `stdout` survives whole.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Results at or under this stay byte-identical. See the threshold arithmetic
 *  in the module comment — this is the knee of the recovery curve, not a
 *  round number. */
export const TOOL_RESULT_MAX = 2048;
/** Total digest text a spilled result may keep in context, across all of its
 *  string leaves. 1.5× cross-org.ts's MAIL_DIGEST_CHARS: a tool result has to
 *  carry a stack trace where a mail body only has to carry a subject. */
export const TOOL_DIGEST_CHARS = 1536;

/** Tools whose output is read top-down — the head is the useful end. Everything
 *  else is treated as command-shaped (tail-weighted), because Bash is 76% of
 *  the calls and an unknown tool is far more likely to be command-shaped. */
const HEAD_WEIGHTED = new Set(['Read', 'NotebookRead', 'Glob', 'Grep', 'WebFetch']);

export interface SpilledToolResult {
  /** Bounded replacement for the model's transcript — same shape as the
   *  original response, with its long string leaves digested. */
  output: unknown;
  /** Absolute path the full body was written to, as referenced in `output`. */
  file: string;
}

interface Leaf {
  value: string;
  /** Dotted path of the leaf inside the response, for the spill file's
   *  section headers. Empty for a response that IS a string. */
  label: string;
}

/** Every string leaf of a tool response, in a stable traversal order that
 *  `rebuild` replays exactly. */
function collect(value: unknown, label: string, out: Leaf[]): void {
  if (typeof value === 'string') {
    out.push({ value, label });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, label ? `${label}[${i}]` : `[${i}]`, out));
    return;
  }
  if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      collect(v, label ? `${label}.${k}` : k, out);
}

/** Same traversal as `collect`, substituting each leaf from `next` in order. */
function rebuild(value: unknown, next: () => string): unknown {
  if (typeof value === 'string') return next();
  if (Array.isArray(value)) return value.map((v) => rebuild(v, next));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rebuild(v, next)]),
    );
  return value;
}

/** head + note + tail, weighted by tool kind. `keep` is the character budget
 *  for the retained text; the note is on top of it (it is the pointer, not
 *  content, and dropping it would make the spill unrecoverable). */
function digest(value: string, keep: number, headWeighted: boolean, file: string): string {
  if (value.length <= keep) return value;
  const head = Math.round(keep * (headWeighted ? 2 / 3 : 1 / 3));
  const tail = keep - head;
  const elided = value.length - keep;
  const note = `\n\n[... ${elided} chars elided — full tool result at ${file} — Read it if needed]\n\n`;
  return value.slice(0, head) + note + (tail > 0 ? value.slice(value.length - tail) : '');
}

/** What gets written to disk: the raw text when only one leaf carries content
 *  (the overwhelmingly common case — Bash with an empty stderr, or a plain
 *  string response), otherwise labelled sections so a multi-leaf response
 *  stays readable AND attributable. Empty leaves are omitted: they carry no
 *  data and a `=== stderr ===` with nothing under it only makes the file
 *  harder to read. */
function renderFull(leaves: Leaf[]): string {
  const filled = leaves.filter((l) => l.value.length > 0);
  if (filled.length === 1) return filled[0].value;
  return filled.map((l) => `=== ${l.label} ===\n${l.value}`).join('\n\n');
}

/**
 * Bound one tool result. Returns undefined when nothing needs doing (the
 * result is at or under TOOL_RESULT_MAX) or when the spill write failed — in
 * both cases the caller leaves the original result alone, so content is never
 * lost to a disk error.
 */
export function spillToolResult(
  dir: string,
  toolName: string,
  toolUseId: string,
  response: unknown,
): SpilledToolResult | undefined {
  const leaves: Leaf[] = [];
  collect(response, '', leaves);
  const total = leaves.reduce((n, l) => n + l.value.length, 0);
  if (total <= TOOL_RESULT_MAX) return undefined;

  // Full body to disk FIRST — nothing is elided until it is recoverable.
  const file = join(dir, `${toolUseId.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, renderFull(leaves));
  } catch {
    return undefined; // spill failed — deliver in full rather than lose content
  }

  // Water-fill the digest budget smallest-leaf-first: short leaves (a 200-char
  // stderr) keep every character, and whatever is left over goes to the leaf
  // that actually carries the mass. Total retained text <= TOOL_DIGEST_CHARS.
  const headWeighted = HEAD_WEIGHTED.has(toolName);
  const keeps = new Map<Leaf, number>();
  let remaining = TOOL_DIGEST_CHARS;
  const ascending = [...leaves].sort((a, b) => a.value.length - b.value.length);
  ascending.forEach((leaf, i) => {
    const share = Math.floor(remaining / (ascending.length - i));
    const keep = Math.min(leaf.value.length, share);
    keeps.set(leaf, keep);
    remaining -= keep;
  });

  let i = 0;
  const output = rebuild(response, () => {
    const leaf = leaves[i++];
    return digest(leaf.value, keeps.get(leaf) ?? 0, headWeighted, file);
  });
  return { output, file };
}

/** Minimal shape of the SDK's PostToolUse hook input this needs. */
interface PostToolUseInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
}

/**
 * A `PostToolUse` hook for the Claude Agent SDK. This is the ONLY layer that
 * can rewrite a tool result before it reaches the model: Bash and Read run
 * inside the SDK's own CLI process, so the org runtime never touches their
 * output — `agent-runner.ts`'s `tool_result` stream is read-only observation,
 * emitted after the transcript already holds the full text. The SDK does
 * expose the seam we need here (`PostToolUseHookSpecificOutput.
 * updatedToolOutput`: "Replaces the tool output before it is sent to the
 * model"), so the clean approach is achievable — for the Claude path. The
 * vendor runners (codex/opencode/qwen/…) drive their own CLIs and have no
 * equivalent, so they are out of scope here.
 */
export function toolResultSpillHook(
  dir: string,
): (input: PostToolUseInput) => Promise<Record<string, unknown>> {
  return async (input: PostToolUseInput) => {
    const spilled = spillToolResult(
      dir,
      String(input.tool_name ?? ''),
      String(input.tool_use_id ?? `t${Date.now()}`),
      input.tool_response,
    );
    if (!spilled) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: spilled.output,
      },
    };
  };
}
