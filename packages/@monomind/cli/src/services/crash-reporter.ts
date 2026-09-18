/**
 * Crash reporter — shared across the monoes tool family.
 *
 * monomind's own uncaught-exception handler uses this directly. mono-agent
 * (Go), monotask, and mono-clip (Rust) shell out to `monomind report-crash`
 * from their own panic/recover handlers so redaction, dedup, and GitHub auth
 * logic live in exactly one place instead of being reimplemented per language.
 *
 * Consent is asked once, on the first interactive crash (a local report path
 * is shown before asking; default answer is No). Until you've answered, a
 * non-interactive crash (CI, agents — most real runs) never asks and only
 * saves locally, never filing. Once you've explicitly chosen — via the
 * prompt or `monomind crash-reporting enable`/`disable` — that answer is
 * used every time, interactive or not; `monomind crash-reporting status`
 * shows the current state.
 *
 * Consent state and the interactive prompt live in ./crash-consent.ts; the
 * advisory lock around the ledger lives in ./crash-lock.ts.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { redact } from '../utils/redaction.js';
import {
  ensureStateDir,
  getConsentState,
  isInteractiveTty,
  promptForConsent,
  readJsonSafe,
  STATE_DIR,
  setEnabled,
  writeJsonSafe,
} from './crash-consent.js';
import { acquireLock, releaseLock } from './crash-lock.js';

export type { ConsentState } from './crash-consent.js';
export { getConsentState, setEnabled } from './crash-consent.js';

const execFileAsync = promisify(execFile);

const LEDGER_PATH = join(STATE_DIR, 'crash-reports.json');
const PENDING_DIR = join(STATE_DIR, 'pending-reports');

const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PER_REPO = 5; // circuit breaker independent of per-signature dedup

export interface CrashReportInput {
  /** e.g. "monoes/monomind", "monoes/mono-agent" */
  repo: string;
  title: string;
  body: string;
  /** Stable key for dedup — same crash shouldn't file twice. Derived from title if omitted. */
  signature?: string;
}

export interface CrashReportResult {
  status: 'created' | 'duplicate' | 'saved-locally' | 'disabled' | 'rate-limited' | 'error';
  url?: string;
  path?: string;
  message: string;
}

interface LedgerEntry {
  url: string;
  repo: string;
  reportedAt: number;
}

interface Ledger {
  bySignature: Record<string, LedgerEntry>;
  /** Timestamps of every issue filed per repo, for the rate-limit circuit breaker. */
  filedAtByRepo: Record<string, number[]>;
  /**
   * Signatures already saved locally while unanswered + non-interactive, so
   * a crash-looping agent or CI job doesn't pile up one .md file per
   * iteration (no dedup previously applied to that path at all). Separate
   * from `bySignature`, which is reserved for real GitHub issues — folding
   * a local-only save into the same map would make a later 'enabled' run
   * report "already reported" for a crash that was never actually filed.
   */
  localOnly: Record<string, { path: string; reportedAt: number }>;
}

/**
 * Strip obvious secrets/PII before anything gets sent to a public GitHub repo.
 * Not a substitute for careful callers — this is a last-resort net.
 *
 * Implementation lives in utils/redaction.ts (shared with input-guards.ts's
 * sanitizeError() and neural-optimize.ts's stripPii export path — this was
 * the fullest of the three duplicated implementations, so the others were
 * consolidated onto this one rather than the reverse).
 */
export { redact };

/**
 * Normalize a title before hashing so crashes that differ only in a varying
 * value (an index, an ID, a byte count, an address) collapse to the same
 * signature instead of filing a fresh issue every time. Digits, hex runs,
 * and pointer-looking addresses are stripped rather than just non-alphanumerics.
 */
function normalizeForSignature(title: string): string {
  return title
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '<addr>')
    .replace(/\b[0-9a-f]{8,}\b/g, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/[^a-z0-9<>]+/g, ' ')
    .trim();
}

export function computeSignature(repo: string, title: string): string {
  const normalized = normalizeForSignature(title);
  return createHash('sha1').update(`${repo}:${normalized}`).digest('hex').slice(0, 16);
}

function loadLedger(): Ledger {
  const raw = readJsonSafe<Partial<Ledger>>(LEDGER_PATH, {});
  // Defensive defaults — also covers the pre-rate-limiting ledger format
  // (a flat signature->entry map with no `bySignature` wrapper).
  return {
    bySignature: raw.bySignature ?? {},
    filedAtByRepo: raw.filedAtByRepo ?? {},
    localOnly: raw.localOnly ?? {},
  };
}

function saveLedger(ledger: Ledger): void {
  writeJsonSafe(LEDGER_PATH, ledger);
}

function checkLedger(ledger: Ledger, signature: string): LedgerEntry | null {
  const entry = ledger.bySignature[signature];
  if (!entry) return null;
  if (Date.now() - entry.reportedAt > DEDUP_WINDOW_MS) return null;
  return entry;
}

/** True if this repo has already hit the rolling-window issue-filing cap — an
 * independent circuit breaker for the case where per-signature dedup is
 * defeated by a crash message that varies every time (e.g. a hot-loop panic
 * with a different index/value in the message on every iteration). */
function isRateLimited(ledger: Ledger, repo: string): boolean {
  const recent = (ledger.filedAtByRepo[repo] ?? []).filter(
    (t) => Date.now() - t < RATE_LIMIT_WINDOW_MS,
  );
  return recent.length >= RATE_LIMIT_MAX_PER_REPO;
}

/** Records a dedup entry. Only counts against the rate-limit budget when
 * `countsTowardRateLimit` is true — recognizing an already-filed upstream
 * issue isn't new noise on the repo and shouldn't consume the same budget
 * that's meant to cap genuinely new issue creation. */
function recordFiled(
  ledger: Ledger,
  signature: string,
  repo: string,
  url: string,
  countsTowardRateLimit: boolean,
): void {
  ledger.bySignature[signature] = { url, repo, reportedAt: Date.now() };
  if (countsTowardRateLimit) {
    const recent = (ledger.filedAtByRepo[repo] ?? []).filter(
      (t) => Date.now() - t < RATE_LIMIT_WINDOW_MS,
    );
    recent.push(Date.now());
    ledger.filedAtByRepo[repo] = recent;
  }
}

async function hasGhAuth(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort — checks if an open issue with this exact title already exists upstream. */
async function findExistingUpstreamIssue(repo: string, title: string): Promise<string | null> {
  try {
    // title passed as a single argv element (no shell involved) — a literal
    // `"` inside it can still break the `in:title` search-string parsing on
    // GitHub's side, which just degrades to "no match found", not a security issue.
    const { stdout } = await execFileAsync(
      'gh',
      [
        'issue',
        'list',
        '-R',
        repo,
        '--search',
        `"${title}" in:title`,
        '--json',
        'url,title',
        '--limit',
        '5',
      ],
      { timeout: 8000 },
    );
    const issues: Array<{ url: string; title: string }> = JSON.parse(stdout);
    const match = issues.find((i) => i.title === title);
    return match?.url ?? null;
  } catch {
    return null;
  }
}

async function createIssueViaGh(repo: string, title: string, body: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'gh',
    ['issue', 'create', '-R', repo, '--title', title, '--body', body],
    { timeout: 15000 },
  );
  return stdout.trim().split('\n').pop() ?? stdout.trim();
}

async function createIssueViaToken(
  repo: string,
  title: string,
  body: string,
  token: string,
): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'monomind-crash-reporter',
    },
    body: JSON.stringify({ title, body }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { html_url: string };
  return json.html_url;
}

function saveLocally(repo: string, title: string, body: string): string {
  ensureStateDir();
  if (!existsSync(PENDING_DIR)) mkdirSync(PENDING_DIR, { recursive: true });
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60);
  const path = join(PENDING_DIR, `${Date.now()}-${slug}.md`);
  writeFileSync(path, `# ${title}\n\nRepo: ${repo}\n\n${body}\n`, 'utf8');
  return path;
}

/**
 * Removes the local copy saved before the consent prompt once the same
 * crash has actually been filed upstream — otherwise a Yes answer leaves
 * that pre-prompt file behind forever even though the issue now lives on
 * GitHub. Best-effort and silent: this runs inside a crash handler, which
 * must not throw, and a leftover local file is a cosmetic issue at worst.
 */
function discardPreSavedCopy(path: string | undefined): void {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {
    // already gone, or never existed — fine either way
  }
}

/**
 * Report a crash. Never throws — always resolves to a result the caller can
 * log and move on from, since this runs inside a crash handler. Every step
 * is async (no synchronous blocking child-process calls) so a caller racing
 * this against a timeout (e.g. monomind's own uncaughtException handler)
 * gets a bound that's actually enforceable.
 */
export async function reportCrash(input: CrashReportInput): Promise<CrashReportResult> {
  let lockToken: string | null = null;
  // Set only when the unanswered+TTY branch below saves a local copy before
  // prompting. Reused by the filing pipeline instead of saving a second
  // time, and cleaned up on a successful file (see the two `created`
  // branches) — otherwise a Yes answer can leave an orphaned duplicate on
  // disk forever, or write two files for one crash on a filing failure.
  let preSavedPath: string | undefined;
  try {
    const title = redact(input.title).slice(0, 250);
    const body = redact(input.body).slice(0, 60_000);
    // Run caller-supplied signatures through the same digit/hex/address
    // normalization as derived ones — otherwise an explicit --signature that
    // itself embeds a varying value reopens the dedup-defeat bug this was
    // meant to fix.
    const signature = input.signature
      ? createHash('sha1')
          .update(`${input.repo}:${normalizeForSignature(redact(input.signature))}`)
          .digest('hex')
          .slice(0, 16)
      : computeSignature(input.repo, title);

    // The consent gate lives here, inside reportCrash() itself, rather than
    // at a call site — there are two entry points (monomind's own
    // uncaughtException/unhandledRejection handlers in bin/cli.js, and the
    // hidden `monomind report-crash` command mono-agent/monotask/mono-clip
    // shell out to). A gate at only one of them leaves the other wide open.
    const state = getConsentState();
    if (state === 'disabled') {
      return {
        status: 'disabled',
        message: 'Crash reporting is disabled (monomind crash-reporting enable to turn back on).',
      };
    }

    if (state === 'unanswered') {
      if (!isInteractiveTty()) {
        // Most monomind runs are inside agent sessions and CI — non-TTY.
        // Never prompt, never file, never persist a *consent* decision
        // here: this crash stays "unanswered" forever so a later
        // interactive run can still ask. Deferring to "ask next time"
        // would change nothing for the majority of real runs, which never
        // get a next interactive time.
        const ledger = loadLedger();
        const existingLocal = ledger.localOnly[signature];
        if (existingLocal && Date.now() - existingLocal.reportedAt <= DEDUP_WINDOW_MS) {
          // Same signature saved once already this window — a crash-
          // looping agent or CI job would otherwise pile up one .md file
          // per iteration with no bound at all (this path had no dedup or
          // rate limit of any kind, unlike the filing pipeline below).
          return {
            status: 'saved-locally',
            path: existingLocal.path,
            message: `Crash reporting hasn't been configured yet; this crash was already saved locally: ${existingLocal.path}. Run \`monomind crash-reporting enable\` or \`monomind crash-reporting disable\` to choose, or answer the prompt next time this runs interactively.`,
          };
        }
        const path = saveLocally(input.repo, title, body);
        ledger.localOnly[signature] = { path, reportedAt: Date.now() };
        saveLedger(ledger);
        return {
          status: 'saved-locally',
          path,
          message: `Crash reporting hasn't been configured yet, so this crash was only saved locally (no network call): ${path}. Run \`monomind crash-reporting enable\` or \`monomind crash-reporting disable\` to choose, or answer the prompt next time this runs interactively.`,
        };
      }

      // Show the local report path before asking, so consent isn't blind.
      preSavedPath = saveLocally(input.repo, title, body);
      const consented = await promptForConsent(input.repo, preSavedPath);
      setEnabled(consented);
      if (!consented) {
        return {
          status: 'saved-locally',
          path: preSavedPath,
          message: `Crash reporting is now disabled (monomind crash-reporting disable). Saved locally to ${preSavedPath}. Re-enable any time with \`monomind crash-reporting enable\`.`,
        };
      }
      // Consented: fall through into the normal filing pipeline below, same
      // as an already-'enabled' state. preSavedPath stays set so that
      // pipeline reuses this file instead of writing a second one.
    }

    // Bounded wait — closes the near-simultaneous-crash race without ever
    // blocking the handler for long; proceeds unlocked if still contended.
    lockToken = await acquireLock();

    let ledger = loadLedger();
    const existing = checkLedger(ledger, signature);
    if (existing) {
      return {
        status: 'duplicate',
        url: existing.url,
        message: `Already reported: ${existing.url}`,
      };
    }

    if (isRateLimited(ledger, input.repo)) {
      return {
        status: 'rate-limited',
        message: `Already filed ${RATE_LIMIT_MAX_PER_REPO}+ crash issues on ${input.repo} in the last hour — suppressing further auto-reports to avoid spamming the repo. Saved locally instead.`,
        path: preSavedPath ?? saveLocally(input.repo, title, body),
      };
    }

    const upstreamUrl = await findExistingUpstreamIssue(input.repo, title);
    if (upstreamUrl) {
      ledger = loadLedger();
      recordFiled(ledger, signature, input.repo, upstreamUrl, false);
      saveLedger(ledger);
      return {
        status: 'duplicate',
        url: upstreamUrl,
        message: `Matching issue already exists upstream: ${upstreamUrl}`,
      };
    }

    // Try gh CLI, then GITHUB_TOKEN, falling back to a local save on ANY
    // failure in either path (not just "no auth found") — a transient
    // network/API error shouldn't silently drop the report.
    if (await hasGhAuth()) {
      try {
        const url = await createIssueViaGh(input.repo, title, body);
        ledger = loadLedger();
        recordFiled(ledger, signature, input.repo, url, true);
        saveLedger(ledger);
        discardPreSavedCopy(preSavedPath);
        return { status: 'created', url, message: `Filed: ${url}` };
      } catch (error) {
        const path = preSavedPath ?? saveLocally(input.repo, title, body);
        return {
          status: 'saved-locally',
          path,
          message: `gh issue create failed (${error instanceof Error ? error.message : String(error)}); saved locally to ${path}`,
        };
      }
    }

    const token = process.env.GITHUB_TOKEN;
    if (token) {
      try {
        const url = await createIssueViaToken(input.repo, title, body, token);
        ledger = loadLedger();
        recordFiled(ledger, signature, input.repo, url, true);
        saveLedger(ledger);
        discardPreSavedCopy(preSavedPath);
        return { status: 'created', url, message: `Filed: ${url}` };
      } catch (error) {
        const path = preSavedPath ?? saveLocally(input.repo, title, body);
        return {
          status: 'saved-locally',
          path,
          message: `GitHub API issue creation failed (${error instanceof Error ? error.message : String(error)}); saved locally to ${path}`,
        };
      }
    }

    const path = preSavedPath ?? saveLocally(input.repo, title, body);
    return {
      status: 'saved-locally',
      path,
      message: `No GitHub auth found (gh CLI or GITHUB_TOKEN). Report saved to ${path} — file it yourself with: gh issue create -R ${input.repo} --title "..." --body-file "${path}"`,
    };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  } finally {
    releaseLock(lockToken);
  }
}
