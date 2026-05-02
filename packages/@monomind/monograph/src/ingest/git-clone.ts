/**
 * Git Clone Utility with SSRF Protection
 *
 * Shallow-clones repositories into ~/.monograph/repos/{name}/.
 * If already cloned, runs `git pull --ff-only` instead.
 *
 * SSRF protection mirrors GitNexus's git-clone.ts: only https:// and http://
 * are allowed, and private/internal IP ranges are blocked.
 */

import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { isIP } from 'net';

// ── SSRF validation ───────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.internal',
  'metadata.goog',
]);

/**
 * Validate a git URL to prevent SSRF attacks.
 *
 * Blocks:
 * - Non-http(s) schemes
 * - Private IPv4 ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, etc.)
 * - IPv6 private ranges (::1, fc00::/7, fe80::/10, ::ffff:...)
 * - Cloud metadata hostnames
 * - Numeric IP encodings (decimal/hex)
 *
 * @throws {Error} with a descriptive message if the URL is not safe.
 */
export function validateGitUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Only https:// and http:// git URLs are allowed');
  }

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }

  // Strip IPv6 brackets
  let normalizedHost = host;
  if (host.startsWith('[') && host.endsWith(']')) {
    normalizedHost = host.slice(1, -1);
  }

  // Detect IPv6
  const isIPv6 = isIP(normalizedHost) === 6 || normalizedHost.includes(':');
  if (isIPv6) {
    assertNotPrivateIPv6(normalizedHost);
    return;
  }

  // Detect IPv4
  if (isIP(normalizedHost) === 4) {
    assertNotPrivateIPv4(normalizedHost);
    return;
  }

  // Block numeric IP encodings (decimal: 2130706433, hex: 0x7f000001)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }

  // Standard IPv4 dotted-notation private checks
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    host === '0.0.0.0' ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^198\.1[89]\./.test(host)
  ) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
}

function assertNotPrivateIPv6(ip: string): void {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
  if (
    lower.startsWith('fe80') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
  if (lower.startsWith('::ffff:') || lower.includes(':ffff:')) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
}

function assertNotPrivateIPv4(ip: string): void {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  ) {
    throw new Error('Cloning from private/internal addresses is not allowed');
  }
}

// ── URL helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the repository name from an HTTPS or SSH git URL.
 *
 * @example
 * extractRepoName('https://github.com/org/repo.git') // 'repo'
 * extractRepoName('git@github.com:org/repo.git')     // 'repo'
 */
export function extractRepoName(url: string): string {
  const cleaned = url.replace(/\/+$/, '');
  const lastSegment = cleaned.split(/[/:]/).pop() ?? 'unknown';
  return lastSegment.replace(/\.git$/, '');
}

/**
 * Get the default clone target directory for a repository name.
 * Repositories are stored in `~/.monograph/repos/{repoName}`.
 */
export function getCloneDir(repoName: string): string {
  return path.join(os.homedir(), '.monograph', 'repos', repoName);
}

// ── Clone / pull ───────────────────────────────────────────────────────────────

export interface CloneProgress {
  phase: 'cloning' | 'pulling';
  message: string;
}

/**
 * Clone or pull a git repository with SSRF protection.
 *
 * - If `targetDir/.git` does not exist: `git clone --depth 1 <url> <targetDir>`
 * - If `targetDir/.git` exists: `git pull --ff-only`
 *
 * The URL is validated against SSRF rules before any network operation.
 *
 * @param url       - The git remote URL (must be https:// or http://).
 * @param targetDir - Local directory to clone into.
 * @param onProgress - Optional progress callback.
 * @returns Resolves to `targetDir` on success.
 */
export async function cloneOrPull(
  url: string,
  targetDir: string,
  onProgress?: (progress: CloneProgress) => void,
): Promise<string> {
  // Always validate before any operation
  validateGitUrl(url);

  const hasGitDir = await fs.access(path.join(targetDir, '.git')).then(
    () => true,
    () => false,
  );

  if (hasGitDir) {
    onProgress?.({ phase: 'pulling', message: 'Pulling latest changes…' });
    await runGit(['pull', '--ff-only'], targetDir);
  } else {
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    onProgress?.({ phase: 'cloning', message: `Cloning ${url}…` });
    await runGit(['clone', '--depth', '1', url, targetDir]);
  }

  return targetDir;
}

// ── git subprocess ─────────────────────────────────────────────────────────────

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: process.platform === 'win32' ? 'echo' : '/bin/true',
      },
    });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        if (stderr.trim()) {
          console.error(`git ${args[0]} stderr: ${stderr.trim()}`);
        }
        reject(new Error(`git ${args[0]} failed (exit code ${code})`));
      }
    });

    proc.on('error', err => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}
