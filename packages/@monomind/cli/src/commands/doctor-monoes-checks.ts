/**
 * Doctor — monoes tool family checks (monotask, mono-agent, mono-clip)
 *
 * Opt-in component only (`monomind doctor -c monoes-tools`) — not part of the
 * always-on check set, since these are unrelated sibling tools on this machine,
 * not monomind dependencies. Catches known Homebrew tap-rename and Gatekeeper
 * issues discovered while installing them via /monoes:install.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { output } from '../output.js';
import type { HealthCheck } from './doctor-env-checks.js';
import { runCommand } from './doctor-env-checks.js';

interface MonoesIssue {
  message: string;
  fixCommand: string;
}

// i-055 doctor follow-up, finding 4b (revised per review finding 13): fixed
// literals only, no interpolation — a caught error or token value must
// never reach either of these (see checkMonoesTokenExposure() below for
// how they're selected). Keyed on WHAT WAS FOUND, not on whether a
// connection file happens to exist: a literal bearer token sitting in a
// (possibly team-committed) .mcp.json is a real credential exposure
// regardless of whether THIS user has ever connected — "they never used
// Disconnect -> Connect" is irrelevant to whether the token itself must be
// revoked. REVOKE_LINE therefore applies to every failure; DISCONNECT_LINE
// is additive, only when an actual connection file was found flagged by
// git (there's a live app connection to disconnect from). There is
// deliberately no "your connection file is unreadable" sentence — this
// function never reads that file's content at all (only existsSync plus
// git tracked/ignored status), so it can never truthfully claim that.
const REVOKE_LINE =
  'Treat this token as compromised: revoke it at https://monoes.me (Settings -> Connected apps). If it reached git history, rewriting the file does not remove it.';
const DISCONNECT_LINE = 'Run `monomind ui`, then monoes.me -> Disconnect -> Connect.';

/**
 * True if `.mcp.json`'s raw text contains a literal bearer token, checked
 * at the specific path this item's writers ever wrote one
 * (`mcpServers.monoes.headers.Authorization`) rather than a whole-file
 * regex. i-066 reviewer finding 6: a whole-file scan trips on any other MCP
 * server the project has configured with an unrelated bearer header, and
 * claims a hit at a JSON key it never actually looked at. Falls back to the
 * raw regex only when the file fails to parse (a hand-corrupted file
 * shouldn't silently hide a real leak). Presence-only either way — the
 * value itself is never read into a variable that could be logged.
 * Deliberately duplicated rather than imported from
 * mcp/monoes-mcp-entry.mjs's identical `_hasLegacyBearerEntry` — two call
 * sites is not a shared abstraction (dev-lead, i-066 plan §3.6).
 */
function hasLegacyMonoesBearerEntry(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    const auth = parsed?.mcpServers?.monoes?.headers?.Authorization;
    return typeof auth === 'string' && /^Bearer\s+\S+/.test(auth);
  } catch {
    return /"Authorization"\s*:\s*"Bearer\s+[^"]+"/.test(raw);
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await runCommand(`command -v ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

async function findMonoesIssues(): Promise<MonoesIssue[]> {
  const issues: MonoesIssue[] = [];

  // 1. Tap rename ambiguity: nokhodian/tap was renamed to monoes/tap. Having both
  //    tapped makes formula/cask lookups ambiguous ("found in multiple taps").
  try {
    const taps = await runCommand('brew tap');
    const hasOld = /(^|\n)nokhodian\/tap(\n|$)/.test(taps);
    const hasNew = /(^|\n)monoes\/tap(\n|$)/.test(taps);
    if (hasOld && hasNew) {
      // --force is safe here: brew refuses a plain untap because it sees formula/cask
      // names matching this tap's checkout, even when they're actually installed from
      // monoes/tap (same upstream repo, redirected). Verified against INSTALL_RECEIPT.json
      // before relying on this — the receipts point at monoes/tap, not this one.
      issues.push({
        message:
          'both nokhodian/tap and monoes/tap are tapped — formula/cask lookups are ambiguous',
        fixCommand: 'brew untap --force nokhodian/tap',
      });
    } else if (hasOld && !hasNew) {
      issues.push({
        message: 'nokhodian/tap is tapped but was renamed to monoes/tap',
        fixCommand: 'brew untap --force nokhodian/tap && brew tap monoes/tap',
      });
    }
  } catch {
    // brew not usable for tap listing — skip this sub-check
  }

  // 2. monotask formula installed but not linked as `monotask` on PATH. Homebrew
  //    ships the raw binary as `monotaskcli` and skips auto-linking when the
  //    same-named `monotask` cask is also installed.
  try {
    const cellarRoot = await runCommand('brew --cellar');
    if (cellarRoot && existsSync(`${cellarRoot}/monotask`) && !(await commandExists('monotask'))) {
      issues.push({
        message:
          "monotask formula is installed but 'monotask' isn't on PATH (Homebrew installs it as 'monotaskcli' and skips linking when the same-named cask is present)",
        fixCommand:
          'ln -sf "$(brew --cellar)"/monotask/*/bin/monotaskcli "$(brew --prefix)/bin/monotask"',
      });
    }
  } catch {
    // skip
  }

  // 3. MonoClip.app quarantined/unsigned — macOS can silently move it to Trash on
  //    its first launch instead of showing the "damaged" dialog.
  try {
    if (existsSync('/Applications/MonoClip.app')) {
      let quarantined = true;
      try {
        await runCommand('xattr -p com.apple.quarantine "/Applications/MonoClip.app"');
      } catch {
        quarantined = false;
      }
      if (quarantined) {
        issues.push({
          message:
            'MonoClip.app is quarantined — macOS may silently move it to Trash on first launch',
          fixCommand:
            'find /Applications/MonoClip.app -print0 | xargs -0 xattr -c && codesign --force --deep --sign - /Applications/MonoClip.app',
        });
      }
    }
  } catch {
    // skip
  }

  // 4. mono-agent (monoagentcli) — distributed as a raw GitHub release binary, not
  //    through Homebrew, so it never gets picked up by `brew upgrade`. Check it
  //    against the latest GitHub release directly.
  try {
    if (await commandExists('monoagentcli')) {
      const versionOut = await runCommand('monoagentcli version');
      const m = versionOut.match(/v?(\d+\.\d+\.\d+)/);
      if (m) {
        const current = m[1];
        try {
          const releaseJson = await runCommand(
            'curl -fsSL https://api.github.com/repos/monoes/mono-agent/releases/latest',
            8000,
          );
          const latestTag = (JSON.parse(releaseJson).tag_name || '').replace(/^v/, '');
          if (latestTag && latestTag !== current) {
            issues.push({
              message: `monoagentcli is v${current}, latest release is v${latestTag}`,
              fixCommand:
                'ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=amd64; ' +
                'curl -fsSL --max-time 30 "https://github.com/monoes/mono-agent/releases/latest/download/monoagentcli-darwin-${ARCH}" -o /tmp/monoagentcli && ' +
                'chmod +x /tmp/monoagentcli && sudo mv /tmp/monoagentcli /usr/local/bin/monoagentcli',
            });
          }
        } catch {
          // GitHub API unreachable/rate-limited — skip version-freshness sub-check
        }
      }
    }
  } catch {
    // skip
  }

  return issues;
}

export async function checkMonoesTools(): Promise<HealthCheck> {
  if (process.platform !== 'darwin') {
    return {
      name: 'monoes Tools',
      status: 'pass',
      message: 'Skipped (macOS-only — monotask/mono-agent/mono-clip are macOS tools)',
    };
  }

  const issues = await findMonoesIssues();
  if (issues.length === 0) {
    return {
      name: 'monoes Tools',
      status: 'pass',
      message: 'No known monotask/mono-agent/mono-clip install issues detected',
    };
  }
  return {
    name: 'monoes Tools',
    status: 'warn',
    message: issues.map((i) => i.message).join('; '),
    fix: issues.map((i) => i.fixCommand).join('  |  '),
  };
}

/**
 * i-066: verifies the monoes.me OAuth token isn't exposed to git — neither
 * as a literal bearer value still sitting in `.mcp.json` (pre-fix state, or
 * hand-edited back in) nor as an untracked-but-unprotected or git-tracked
 * `monoes-connection.json`.
 *
 * Deliberately reports PRESENCE only, never the token VALUE — a doctor
 * check that echoed the offending line would re-leak the secret into
 * terminal scrollback and CI logs, exactly the places people paste from
 * when asking for help.
 */
export async function checkMonoesTokenExposure(): Promise<HealthCheck> {
  const cwd = process.cwd();
  const issues: string[] = [];
  // Tracks WHAT KIND of issue was found, independent of each other, so the
  // closing remediation can be keyed on the actual exposure rather than on
  // an unrelated fact (whether a connection file happens to exist — see
  // review finding 13, which caught the previous version of this function
  // doing exactly that).
  let hasConnectionFileIssue = false;

  const mcpJsonPath = join(cwd, '.mcp.json');
  if (existsSync(mcpJsonPath)) {
    try {
      const raw = readFileSync(mcpJsonPath, 'utf8');
      if (hasLegacyMonoesBearerEntry(raw)) {
        issues.push('.mcp.json contains a literal bearer token');
      }
    } catch {
      // unreadable — nothing to check
    }
  }

  const connectionRelPath = '.monomind/monoes-connection.json';
  const connectionPath = join(cwd, connectionRelPath);
  if (existsSync(connectionPath)) {
    // i-066 reviewer finding 5: outside a git work tree, `git check-ignore`
    // and `git ls-files` both exit non-zero for reasons that have nothing
    // to do with exposure (there is no git to leak through at all) — the
    // old code read that as tracked=false, ignored=false and failed a
    // zero-exposure user in a non-git project. Probe for a real work tree
    // first; if there isn't one, this check simply doesn't apply.
    let insideWorkTree = false;
    try {
      await runCommand('git rev-parse --is-inside-work-tree');
      insideWorkTree = true;
    } catch {
      insideWorkTree = false;
    }

    if (insideWorkTree) {
      let ignored = false;
      try {
        await runCommand(`git check-ignore "${connectionRelPath}"`);
        ignored = true;
      } catch {
        ignored = false;
      }
      let tracked = false;
      try {
        await runCommand(`git ls-files --error-unmatch "${connectionRelPath}"`);
        tracked = true;
      } catch {
        tracked = false;
      }
      if (tracked) {
        issues.push(`${connectionRelPath} is tracked by git — treat the token as compromised`);
        hasConnectionFileIssue = true;
      } else if (!ignored) {
        issues.push(`${connectionRelPath} exists but is not covered by .gitignore`);
        hasConnectionFileIssue = true;
      }
    }
  }

  if (issues.length === 0) {
    return {
      name: 'monoes Token Exposure',
      status: 'pass',
      message: 'No monoes.me token exposure detected',
    };
  }

  // Fixed literals only, never interpolated — this message can reach a
  // terminal or CI log, so it must never echo a caught error or a token
  // value. REVOKE_LINE applies to every failure here: a literal bearer
  // token in .mcp.json is a real credential exposure independent of
  // whether THIS user ever connected (a teammate's commit, an older
  // install, a pulled branch can all put it there) — a token you didn't
  // create and can't rotate yourself is more urgent to escalate, not less.
  // DISCONNECT_LINE is additive, only when an actual connection file was
  // found and flagged by git — that's the only case where there's a live
  // app connection to disconnect from at all.
  const remediation = hasConnectionFileIssue ? `${REVOKE_LINE} ${DISCONNECT_LINE}` : REVOKE_LINE;

  return {
    name: 'monoes Token Exposure',
    status: 'fail',
    message: `${issues.join('; ')}. ${remediation}`,
  };
}

export async function fixMonoesTools(): Promise<boolean> {
  output.writeln();
  output.writeln(output.bold('Applying monoes tools fixes...'));

  const issues = await findMonoesIssues();
  if (issues.length === 0) {
    output.writeln(output.dim('Nothing to fix.'));
    return true;
  }

  let allOk = true;
  for (const issue of issues) {
    try {
      // 2min timeout: generous enough for an interactive sudo password prompt
      // (mono-agent's fix uses sudo mv), but still bounded — avoids hanging the
      // whole `doctor --install` run on a stalled brew/curl network call.
      execSync(issue.fixCommand, {
        encoding: 'utf8',
        stdio: 'inherit',
        shell: '/bin/bash',
        timeout: 120_000,
      });
      output.writeln(output.success(`Fixed: ${issue.message}`));
    } catch (error) {
      allOk = false;
      output.writeln(output.warning(`Fix failed for: ${issue.message}`));
      if (error instanceof Error) output.writeln(output.dim(error.message));
    }
  }
  return allOk;
}
