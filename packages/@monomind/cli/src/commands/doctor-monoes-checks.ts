/**
 * Doctor — monoes tool family checks (monotask, mono-agent, mono-clip)
 *
 * Opt-in component only (`monomind doctor -c monoes-tools`) — not part of the
 * always-on check set, since these are unrelated sibling tools on this machine,
 * not monomind dependencies. Catches known Homebrew tap-rename and Gatekeeper
 * issues discovered while installing them via /monoes:install.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { output } from '../output.js';
import { runCommand } from './doctor-env-checks.js';
import type { HealthCheck } from './doctor-env-checks.js';

interface MonoesIssue {
  message: string;
  fixCommand: string;
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
        message: 'both nokhodian/tap and monoes/tap are tapped — formula/cask lookups are ambiguous',
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
        message: "monotask formula is installed but 'monotask' isn't on PATH (Homebrew installs it as 'monotaskcli' and skips linking when the same-named cask is present)",
        fixCommand: 'ln -sf "$(brew --cellar)"/monotask/*/bin/monotaskcli "$(brew --prefix)/bin/monotask"',
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
          message: 'MonoClip.app is quarantined — macOS may silently move it to Trash on first launch',
          fixCommand: 'find /Applications/MonoClip.app -print0 | xargs -0 xattr -c && codesign --force --deep --sign - /Applications/MonoClip.app',
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
            8000
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
    return { name: 'monoes Tools', status: 'pass', message: 'Skipped (macOS-only — monotask/mono-agent/mono-clip are macOS tools)' };
  }

  const issues = await findMonoesIssues();
  if (issues.length === 0) {
    return { name: 'monoes Tools', status: 'pass', message: 'No known monotask/mono-agent/mono-clip install issues detected' };
  }
  return {
    name: 'monoes Tools',
    status: 'warn',
    message: issues.map(i => i.message).join('; '),
    fix: issues.map(i => i.fixCommand).join('  |  '),
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
      execSync(issue.fixCommand, { encoding: 'utf8', stdio: 'inherit', shell: '/bin/bash', timeout: 120_000 });
      output.writeln(output.success(`Fixed: ${issue.message}`));
    } catch (error) {
      allOk = false;
      output.writeln(output.warning(`Fix failed for: ${issue.message}`));
      if (error instanceof Error) output.writeln(output.dim(error.message));
    }
  }
  return allOk;
}
