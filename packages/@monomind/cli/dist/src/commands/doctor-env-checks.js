/**
 * Doctor — system/environment health checks
 * Node, npm, git, disk, TypeScript, Claude CLI, version freshness
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { output } from '../output.js';
export const MAX_DOCTOR_PKG_BYTES = 1024 * 1024; // 1 MB
export const MAX_DOCTOR_CONFIG_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DOCTOR_GITIGNORE_BYTES = 512 * 1024; // 512 KB
export const MAX_DOCTOR_PID_BYTES = 64; // 64 bytes
export const MAX_DOCTOR_HELPER_BYTES = 2 * 1024 * 1024; // 2 MB
const execAsync = promisify(exec);
export async function runCommand(command, timeoutMs = 5000) {
    const { stdout } = await execAsync(command, {
        encoding: 'utf8',
        timeout: timeoutMs,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        env: { ...process.env },
        windowsHide: true,
    });
    return stdout.trim();
}
export async function checkNodeVersion() {
    const requiredMajor = 20;
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    if (major >= requiredMajor) {
        return { name: 'Node.js Version', status: 'pass', message: `${version} (>= ${requiredMajor} required)` };
    }
    else if (major >= 18) {
        return { name: 'Node.js Version', status: 'warn', message: `${version} (>= ${requiredMajor} recommended)`, fix: 'nvm install 20 && nvm use 20' };
    }
    return { name: 'Node.js Version', status: 'fail', message: `${version} (>= ${requiredMajor} required)`, fix: 'nvm install 20 && nvm use 20' };
}
export async function checkNpmVersion() {
    try {
        const version = await runCommand('npm --version');
        const major = parseInt(version.split('.')[0], 10);
        if (major >= 9)
            return { name: 'npm Version', status: 'pass', message: `v${version}` };
        return { name: 'npm Version', status: 'warn', message: `v${version} (>= 9 recommended)`, fix: 'npm install -g npm@latest' };
    }
    catch {
        return { name: 'npm Version', status: 'fail', message: 'npm not found', fix: 'Install Node.js from https://nodejs.org' };
    }
}
export async function checkGit() {
    try {
        const version = await runCommand('git --version');
        return { name: 'Git', status: 'pass', message: version.replace('git version ', 'v') };
    }
    catch {
        return { name: 'Git', status: 'warn', message: 'Not installed', fix: 'Install git from https://git-scm.com' };
    }
}
export async function checkGitRepo() {
    try {
        await runCommand('git rev-parse --git-dir');
        return { name: 'Git Repository', status: 'pass', message: 'In a git repository' };
    }
    catch {
        return { name: 'Git Repository', status: 'warn', message: 'Not a git repository', fix: 'git init' };
    }
}
export async function checkDiskSpace() {
    try {
        if (process.platform === 'win32')
            return { name: 'Disk Space', status: 'pass', message: 'Check skipped on Windows' };
        const output_str = await runCommand('df -Ph . | tail -1');
        const parts = output_str.split(/\s+/);
        const available = parts[3];
        const usePercent = parseInt(parts[4]?.replace('%', '') || '0', 10);
        if (isNaN(usePercent))
            return { name: 'Disk Space', status: 'warn', message: `${available || 'unknown'} available (unable to parse usage)` };
        if (usePercent > 90)
            return { name: 'Disk Space', status: 'fail', message: `${available} available (${usePercent}% used)`, fix: 'Free up disk space' };
        if (usePercent > 80)
            return { name: 'Disk Space', status: 'warn', message: `${available} available (${usePercent}% used)` };
        return { name: 'Disk Space', status: 'pass', message: `${available} available` };
    }
    catch {
        return { name: 'Disk Space', status: 'warn', message: 'Unable to check' };
    }
}
export async function checkBuildTools() {
    try {
        const tscVersion = await runCommand('npx tsc --version', 10000);
        if (!tscVersion || tscVersion.includes('not found')) {
            return { name: 'TypeScript', status: 'warn', message: 'Not installed locally', fix: 'npm install -D typescript' };
        }
        return { name: 'TypeScript', status: 'pass', message: tscVersion.replace('Version ', 'v') };
    }
    catch {
        return { name: 'TypeScript', status: 'warn', message: 'Not installed locally', fix: 'npm install -D typescript' };
    }
}
export async function checkVersionFreshness() {
    try {
        let currentVersion = '0.0.0';
        try {
            const thisFile = fileURLToPath(import.meta.url);
            let dir = dirname(thisFile);
            for (;;) {
                const candidate = join(dir, 'package.json');
                try {
                    if (existsSync(candidate) && statSync(candidate).size <= MAX_DOCTOR_PKG_BYTES) {
                        const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
                        if (pkg.version && typeof pkg.name === 'string' &&
                            (pkg.name === '@monomind/cli' || pkg.name === 'monomind' || pkg.name === '@monoes/monomindcli')) {
                            currentVersion = pkg.version;
                            break;
                        }
                    }
                }
                catch { /* keep walking */ }
                const parent = dirname(dir);
                if (parent === dir)
                    break;
                dir = parent;
            }
        }
        catch {
            currentVersion = '0.0.0';
        }
        const isNpx = process.argv[1]?.includes('_npx') ||
            process.env.npm_execpath?.includes('npx') ||
            process.cwd().includes('_npx');
        let latestVersion = currentVersion;
        try {
            latestVersion = (await runCommand('npm view monomind version', 5000)).trim();
        }
        catch {
            return { name: 'Version Freshness', status: 'warn', message: `v${currentVersion} (cannot check registry)` };
        }
        const parseVer = (v) => {
            const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z]+\.(\d+))?/);
            if (!m)
                return { major: 0, minor: 0, patch: 0, pre: 0 };
            return { major: +m[1], minor: +m[2], patch: +m[3], pre: +(m[4] ?? 0) };
        };
        const cur = parseVer(currentVersion);
        const lat = parseVer(latestVersion);
        const outdated = lat.major > cur.major || (lat.major === cur.major && lat.minor > cur.minor) ||
            (lat.major === cur.major && lat.minor === cur.minor && lat.patch > cur.patch) ||
            (lat.major === cur.major && lat.minor === cur.minor && lat.patch === cur.patch && lat.pre > cur.pre);
        if (outdated) {
            return {
                name: 'Version Freshness',
                status: 'warn',
                message: `v${currentVersion} (latest: v${latestVersion})${isNpx ? ' [npx cache stale]' : ''}`,
                fix: isNpx ? 'rm -rf ~/.npm/_npx/* && npx -y monomind@latest doctor' : 'npm update -g monomind',
            };
        }
        return { name: 'Version Freshness', status: 'pass', message: `v${currentVersion} (up to date)` };
    }
    catch {
        return { name: 'Version Freshness', status: 'warn', message: 'Unable to check version freshness' };
    }
}
export async function checkClaudeCode() {
    try {
        const version = await runCommand('claude --version');
        const m = version.match(/v?(\d+\.\d+\.\d+)/);
        return { name: 'Claude Code CLI', status: 'pass', message: m ? `v${m[1]}` : version };
    }
    catch {
        return { name: 'Claude Code CLI', status: 'warn', message: 'Not installed', fix: 'npm install -g @anthropic-ai/claude-code' };
    }
}
export async function installClaudeCode() {
    try {
        output.writeln();
        output.writeln(output.bold('Installing Claude Code CLI...'));
        execSync('npm install -g @anthropic-ai/claude-code', { encoding: 'utf8', stdio: 'inherit' });
        output.writeln(output.success('Claude Code CLI installed successfully!'));
        return true;
    }
    catch (error) {
        output.writeln(output.error('Failed to install Claude Code CLI'));
        if (error instanceof Error)
            output.writeln(output.dim(error.message));
        return false;
    }
}
//# sourceMappingURL=doctor-env-checks.js.map