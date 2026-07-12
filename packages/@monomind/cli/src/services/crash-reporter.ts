/**
 * Crash reporter — shared across the monoes tool family.
 *
 * monomind's own uncaught-exception handler uses this directly. mono-agent
 * (Go), monotask, and mono-clip (Rust) shell out to `monomind report-crash`
 * from their own panic/recover handlers so redaction, dedup, and GitHub auth
 * logic live in exactly one place instead of being reimplemented per language.
 *
 * Default: ON (files real GitHub issues on crash). Opt out with
 * `monomind crash-reporting disable`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const STATE_DIR = join(homedir(), '.monomind');
const CONFIG_PATH = join(STATE_DIR, 'crash-reporting.json');
const LEDGER_PATH = join(STATE_DIR, 'crash-reports.json');
const PENDING_DIR = join(STATE_DIR, 'pending-reports');
const LOCK_PATH = join(STATE_DIR, 'crash-reports.lock');

const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Worst-case critical section is ~28s (5s hasGhAuth + 8s upstream search + 15s
// issue create) — stale threshold needs real margin above that so a slow-but-
// legitimate holder never gets its lock stolen mid-operation.
const LOCK_STALE_MS = 60 * 1000;
const LOCK_WAIT_MS = 3 * 1000; // bounded poll for a concurrent holder to finish — closes the
                                // near-simultaneous-crash race without blocking the handler for long
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

interface CrashConfig {
  enabled: boolean;
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
}

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function readJsonSafe<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonSafe(path: string, data: unknown): void {
  try {
    ensureStateDir();
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // best-effort — a failed write here shouldn't crash the crash reporter
  }
}

export function isEnabled(): boolean {
  const config = readJsonSafe<CrashConfig>(CONFIG_PATH, { enabled: true });
  return config.enabled !== false;
}

export function setEnabled(enabled: boolean): void {
  writeJsonSafe(CONFIG_PATH, { enabled });
}

/**
 * Strip obvious secrets/PII before anything gets sent to a public GitHub repo.
 * Not a substitute for careful callers — this is a last-resort net.
 */
export function redact(text: string): string {
  let out = text;

  const home = homedir();
  if (home) out = out.split(home).join('~');

  const username = home.split('/').pop();
  if (username && username.length > 2) {
    out = out.replace(new RegExp(`\\b${username}\\b`, 'g'), '<user>');
  }

  // Generic path prefixes, in case a compiled binary's stack trace embeds a
  // *different* machine's home dir (e.g. the CI runner or maintainer's build
  // box) than the one redaction above is keyed to.
  out = out.replace(/\/home\/[^/\s]+/g, '/home/<user>');
  out = out.replace(/\/Users\/[^/\s]+/g, '/Users/<user>');
  out = out.replace(/C:\\Users\\[^\\\s]+/g, 'C:\\Users\\<user>');

  const SECRET_PATTERNS: RegExp[] = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
    /(?:secret|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
    /(?:token|bearer)\s*[:=]\s*['"]?[^\s'"]{10,}['"]?/gi,
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    /sk-[a-zA-Z0-9_-]{20,}/g,
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /npm_[a-zA-Z0-9]{36}/g,
    /AKIA[0-9A-Z]{16}/g,
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWT
    /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s]+:[^@\s]+@[^\s'"]+/g,        // user:pass@host connection strings
  ];
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');

  return out;
}

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
  return { bySignature: raw.bySignature ?? {}, filedAtByRepo: raw.filedAtByRepo ?? {} };
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
  const recent = (ledger.filedAtByRepo[repo] ?? []).filter(t => Date.now() - t < RATE_LIMIT_WINDOW_MS);
  return recent.length >= RATE_LIMIT_MAX_PER_REPO;
}

/** Records a dedup entry. Only counts against the rate-limit budget when
 * `countsTowardRateLimit` is true — recognizing an already-filed upstream
 * issue isn't new noise on the repo and shouldn't consume the same budget
 * that's meant to cap genuinely new issue creation. */
function recordFiled(ledger: Ledger, signature: string, repo: string, url: string, countsTowardRateLimit: boolean): void {
  ledger.bySignature[signature] = { url, repo, reportedAt: Date.now() };
  if (countsTowardRateLimit) {
    const recent = (ledger.filedAtByRepo[repo] ?? []).filter(t => Date.now() - t < RATE_LIMIT_WINDOW_MS);
    recent.push(Date.now());
    ledger.filedAtByRepo[repo] = recent;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Tries once to atomically create the lock file with an ownership token. */
function tryAcquireOnce(token: string): boolean {
  ensureStateDir();
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, token);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort advisory lock around the ledger's check-then-write sequence,
 * to close the race where two near-simultaneous crashes (e.g. a supervisor
 * restarting a process that panics on every startup) both pass the dedup
 * check before either records its result, filing duplicate issues.
 *
 * Returns an ownership token if acquired (pass to releaseLock so it only ever
 * removes its OWN lock, never one a stale-recovery elsewhere already
 * re-acquired), or null if not acquired — callers proceed unlocked rather
 * than block indefinitely, since a lock miss only reopens the same race this
 * exists to narrow, not something worth ever hanging a crash handler over.
 */
async function acquireLock(): Promise<string | null> {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (tryAcquireOnce(token)) return token;

  // Bounded poll: closes the race for genuinely-simultaneous crashes (the
  // common real case — e.g. two crash handlers firing within the same
  // second) without blocking the handler for the full worst-case critical
  // section duration.
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(150);
    if (tryAcquireOnce(token)) return token;
  }

  // Still held — check staleness (crashed holder that never released it).
  try {
    const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
    if (age > LOCK_STALE_MS) {
      unlinkSync(LOCK_PATH);
      if (tryAcquireOnce(token)) return token;
    }
  } catch {
    // lock disappeared or another race — fall through to unlocked
  }
  return null;
}

function releaseLock(token: string | null): void {
  if (!token) return;
  try {
    if (readFileSync(LOCK_PATH, 'utf8') === token) unlinkSync(LOCK_PATH);
    // else: someone else's lock (ours was stolen after going stale) — leave it alone
  } catch {
    // already gone — fine
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
      ['issue', 'list', '-R', repo, '--search', `"${title}" in:title`, '--json', 'url,title', '--limit', '5'],
      { timeout: 8000 }
    );
    const issues: Array<{ url: string; title: string }> = JSON.parse(stdout);
    const match = issues.find(i => i.title === title);
    return match?.url ?? null;
  } catch {
    return null;
  }
}

async function createIssueViaGh(repo: string, title: string, body: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'gh',
    ['issue', 'create', '-R', repo, '--title', title, '--body', body],
    { timeout: 15000 }
  );
  return stdout.trim().split('\n').pop() ?? stdout.trim();
}

async function createIssueViaToken(repo: string, title: string, body: string, token: string): Promise<string> {
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
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const path = join(PENDING_DIR, `${Date.now()}-${slug}.md`);
  writeFileSync(path, `# ${title}\n\nRepo: ${repo}\n\n${body}\n`, 'utf8');
  return path;
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
  try {
    if (!isEnabled()) {
      return { status: 'disabled', message: 'Crash reporting is disabled (monomind crash-reporting enable to turn back on).' };
    }

    const title = redact(input.title).slice(0, 250);
    const body = redact(input.body).slice(0, 60_000);
    // Run caller-supplied signatures through the same digit/hex/address
    // normalization as derived ones — otherwise an explicit --signature that
    // itself embeds a varying value reopens the dedup-defeat bug this was
    // meant to fix.
    const signature = input.signature
      ? createHash('sha1').update(`${input.repo}:${normalizeForSignature(redact(input.signature))}`).digest('hex').slice(0, 16)
      : computeSignature(input.repo, title);

    // Bounded wait — closes the near-simultaneous-crash race without ever
    // blocking the handler for long; proceeds unlocked if still contended.
    lockToken = await acquireLock();

    let ledger = loadLedger();
    const existing = checkLedger(ledger, signature);
    if (existing) {
      return { status: 'duplicate', url: existing.url, message: `Already reported: ${existing.url}` };
    }

    if (isRateLimited(ledger, input.repo)) {
      return {
        status: 'rate-limited',
        message: `Already filed ${RATE_LIMIT_MAX_PER_REPO}+ crash issues on ${input.repo} in the last hour — suppressing further auto-reports to avoid spamming the repo. Saved locally instead.`,
        path: saveLocally(input.repo, title, body),
      };
    }

    const upstreamUrl = await findExistingUpstreamIssue(input.repo, title);
    if (upstreamUrl) {
      ledger = loadLedger();
      recordFiled(ledger, signature, input.repo, upstreamUrl, false);
      saveLedger(ledger);
      return { status: 'duplicate', url: upstreamUrl, message: `Matching issue already exists upstream: ${upstreamUrl}` };
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
        return { status: 'created', url, message: `Filed: ${url}` };
      } catch (error) {
        const path = saveLocally(input.repo, title, body);
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
        return { status: 'created', url, message: `Filed: ${url}` };
      } catch (error) {
        const path = saveLocally(input.repo, title, body);
        return {
          status: 'saved-locally',
          path,
          message: `GitHub API issue creation failed (${error instanceof Error ? error.message : String(error)}); saved locally to ${path}`,
        };
      }
    }

    const path = saveLocally(input.repo, title, body);
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
