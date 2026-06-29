/**
 * monomind sync — local project skill sync with global installation
 *
 * sync / sync check  — compare .monomind/version vs installed global version
 * sync run           — overwrite local skills from global monomind installation
 */
import { output } from '../output.js';
import { checkLocalSync } from '../sync/checker.js';
import { execFileSync } from 'child_process';
import { cpSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
const NPM_TIMEOUT_MS = 5000;
function findGlobalSkillsDir() {
    try {
        const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8', timeout: NPM_TIMEOUT_MS }).trim();
        // npm global layout differs by OS: lib/node_modules on POSIX, node_modules on Windows
        const candidates = [
            join(prefix, 'lib', 'node_modules', 'monomind', 'packages', '@monomind', 'cli', 'dist', 'skills'),
            join(prefix, 'node_modules', 'monomind', 'packages', '@monomind', 'cli', 'dist', 'skills'),
        ];
        for (const dir of candidates) {
            if (existsSync(dir))
                return dir;
        }
        return null;
    }
    catch {
        return null;
    }
}
const checkCommand = {
    name: 'check',
    description: 'Show local vs global monomind version',
    async action() {
        const { localVersion, globalVersion, needsSync } = checkLocalSync();
        if (!localVersion) {
            output.printInfo('No .monomind/version found — run: monomind init');
            return { success: true };
        }
        if (needsSync) {
            output.printWarning(`Out of sync: local v${localVersion} → global v${globalVersion}`);
            output.writeln(`Run: monomind sync run`);
            return { success: true };
        }
        output.printSuccess(`In sync: v${localVersion}`);
        return { success: true };
    },
};
const runCommand = {
    name: 'run',
    description: 'Overwrite local skills from global monomind installation',
    options: [
        { name: 'dry-run', description: 'Show what would change without applying', type: 'boolean' },
    ],
    examples: [
        { command: 'monomind sync run', description: 'Sync local skills to match global install' },
        { command: 'monomind sync run --dry-run', description: 'Preview what would be synced' },
    ],
    async action(ctx) {
        const { localVersion, globalVersion, needsSync } = checkLocalSync();
        if (!needsSync && localVersion !== null) {
            output.printSuccess(`Already in sync: v${localVersion}`);
            return { success: true };
        }
        const globalSkillsDir = findGlobalSkillsDir();
        if (!globalSkillsDir) {
            output.printError('Could not locate global monomind skills directory');
            output.writeln('Ensure monomind is installed globally: npm i -g monomind');
            return { success: false };
        }
        const localSkillsDir = join(process.cwd(), '.claude', 'skills');
        if (ctx.flags['dry-run']) {
            output.printInfo(`Would copy: ${globalSkillsDir}`);
            output.printInfo(`        to: ${localSkillsDir}`);
            output.printInfo(`Would stamp: .monomind/version = ${globalVersion}`);
            return { success: true };
        }
        mkdirSync(localSkillsDir, { recursive: true });
        cpSync(globalSkillsDir, localSkillsDir, { recursive: true, force: true });
        if (globalVersion) {
            writeFileSync(join(process.cwd(), '.monomind', 'version'), globalVersion, 'utf-8');
        }
        output.printSuccess(`Synced to v${globalVersion}`);
        return { success: true };
    },
};
const syncCommand = {
    name: 'sync',
    description: 'Sync local project skills with global monomind installation',
    subcommands: [checkCommand, runCommand],
    examples: [
        { command: 'monomind sync', description: 'Check sync status' },
        { command: 'monomind sync run', description: 'Overwrite local skills from global install' },
        { command: 'monomind sync run --dry-run', description: 'Preview changes' },
    ],
    // Default action (no subcommand): same as `sync check`
    action: checkCommand.action,
};
export default syncCommand;
//# sourceMappingURL=sync.js.map