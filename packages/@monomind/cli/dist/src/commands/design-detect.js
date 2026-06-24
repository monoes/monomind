/**
 * CLI Design Detect Command
 * Thin wrapper around impeccable's design anti-pattern detector
 *
 * github.com/monoes/monomind
 */
import { output } from '../output.js';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { paletteSubcommand } from './design-palette.js';
const execFileAsync = promisify(execFile);
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function isImpeccableAvailable() {
    try {
        await execFileAsync('npx', ['--no-install', 'impeccable', '--version'], { timeout: 5000 });
        return true;
    }
    catch {
        // Try checking via which
        try {
            await execFileAsync('which', ['impeccable'], { timeout: 3000 });
            return true;
        }
        catch {
            return false;
        }
    }
}
function runImpeccable(args) {
    return new Promise((resolve) => {
        const child = spawn('npx', ['impeccable', 'detect', ...args], {
            stdio: 'inherit',
            shell: false,
        });
        child.on('error', (err) => {
            output.printError(`Failed to run impeccable: ${err.message}`);
            resolve(1);
        });
        child.on('close', (code) => {
            resolve(code ?? 0);
        });
    });
}
// ─── detect subcommand ────────────────────────────────────────────────────────
const detectSubcommand = {
    name: 'detect',
    description: 'Detect design anti-patterns in HTML/CSS files using impeccable',
    options: [
        {
            name: 'target',
            short: 't',
            type: 'string',
            description: 'File or directory to scan',
            default: '.',
        },
        {
            name: 'json',
            type: 'boolean',
            description: 'Output results as JSON',
        },
    ],
    examples: [
        { command: 'monomind design detect', description: 'Detect anti-patterns in current directory' },
        { command: 'monomind design detect -t ./src', description: 'Detect anti-patterns in ./src' },
        { command: 'monomind design detect --json', description: 'Machine-readable JSON output' },
    ],
    action: async (ctx) => {
        const target = ctx.flags.target || ctx.args[0] || '.';
        const jsonOutput = ctx.flags.json;
        output.writeln();
        output.writeln(output.bold('Design Anti-Pattern Detection'));
        output.writeln(output.dim('─'.repeat(50)));
        const available = await isImpeccableAvailable();
        if (!available) {
            output.writeln();
            output.writeln(output.warning('impeccable is not installed.'));
            output.writeln();
            output.writeln('Install it to enable design anti-pattern detection:');
            output.writeln(output.dim('  npm install -g impeccable'));
            output.writeln();
            output.writeln('Or run directly without installing:');
            output.writeln(output.dim('  npx impeccable detect <file-or-dir>'));
            output.writeln();
            output.writeln(output.dim('impeccable checks for 46 known design anti-patterns across:'));
            output.writeln(output.dim('  • slop  — AI tells: purple palettes, side-tabs, card grids, italic-serif heroes'));
            output.writeln(output.dim('  • quality — spacing, hierarchy, readability, contrast, motion, typography'));
            return { success: false, message: 'impeccable not installed' };
        }
        output.writeln(output.dim(`Scanning: ${target}`));
        output.writeln();
        const forwardArgs = [target];
        if (jsonOutput)
            forwardArgs.push('--json');
        const exitCode = await runImpeccable(forwardArgs);
        return { success: exitCode === 0, exitCode };
    },
};
// ─── Main design command ──────────────────────────────────────────────────────
export const designCommand = {
    name: 'design',
    description: 'Design tooling: anti-pattern detection, OKLCH palette seeding, and design quality checks',
    subcommands: [detectSubcommand, paletteSubcommand],
    examples: [
        { command: 'monomind design detect', description: 'Detect design anti-patterns' },
        { command: 'monomind design detect -t ./src --json', description: 'JSON output for CI' },
        { command: 'monomind design palette', description: 'Pick an OKLCH brand seed color' },
        { command: 'monomind design palette --from "my-product"', description: 'Deterministic seed from product name' },
    ],
    action: async () => {
        output.writeln();
        output.writeln(output.bold('Monomind Design Tools'));
        output.writeln(output.dim('Anti-pattern detection, OKLCH palette seeding, and design quality checks'));
        output.writeln();
        output.writeln('Subcommands:');
        output.printList([
            'detect   - Detect design anti-patterns using impeccable',
            'palette  - OKLCH brand seed — returns anchor color + mood + composition strategy',
        ]);
        output.writeln();
        output.writeln('Use --help with subcommands for more info');
        output.writeln();
        output.writeln(output.dim('github.com/monoes/monomind'));
        return { success: true };
    },
};
export default designCommand;
//# sourceMappingURL=design-detect.js.map