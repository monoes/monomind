/**
 * CLI Platforms Command
 * Install/uninstall Monograph context instructions for 14 AI coding platforms
 *
 * github.com/nokhodian/monomind
 */
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { output } from '../output.js';
export const SUPPORTED_PLATFORMS = [
    'claude', 'gemini', 'cursor', 'vscode', 'copilot',
    'opencode', 'aider', 'kiro', 'trae', 'claw',
    'droid', 'antigravity', 'hermes', 'codex',
];
const PLATFORM_CONFIG_FILES = {
    claude: ['CLAUDE.md'],
    gemini: ['GEMINI.md'],
    cursor: ['.cursorrules', '.cursor/rules/monomind.mdc'],
    vscode: ['.github/copilot-instructions.md'],
    copilot: ['.github/copilot-instructions.md'],
    opencode: ['AGENTS.md'],
    aider: ['.aider.conf.yml'],
    kiro: ['.kiro/steering/monomind.md'],
    trae: ['.trae/rules/monomind.md'],
    claw: ['.claw/config.md'],
    droid: ['DROID.md'],
    antigravity: ['.antigravity/config.md'],
    hermes: ['HERMES.md'],
    codex: ['AGENTS.md'],
};
const MONOMIND_BLOCK_START = '<!-- monomind:start -->';
const MONOMIND_BLOCK_END = '<!-- monomind:end -->';
function getMonomindInstructions() {
    return `${MONOMIND_BLOCK_START}
# Monograph Knowledge Graph

This repository is indexed by Monograph. Before starting complex tasks:
- Use \`monograph_query\` to search the knowledge graph
- Use \`monograph_neighbors\` to explore dependencies
- Use \`monograph_impact\` to understand change blast radius

Graph is at \`.monomind/monograph.db\`. Rebuild with: \`npx monograph build\`
${MONOMIND_BLOCK_END}
`;
}
function installPlatform(platform, repoPath) {
    const files = PLATFORM_CONFIG_FILES[platform];
    const instructions = getMonomindInstructions();
    const written = [];
    for (const relPath of files) {
        const fullPath = join(repoPath, relPath);
        const dir = dirname(fullPath);
        mkdirSync(dir, { recursive: true });
        if (existsSync(fullPath)) {
            const existing = readFileSync(fullPath, 'utf8');
            if (existing.includes(MONOMIND_BLOCK_START))
                continue;
            writeFileSync(fullPath, existing + '\n' + instructions, 'utf8');
        }
        else {
            writeFileSync(fullPath, instructions, 'utf8');
        }
        written.push(relPath);
    }
    return written;
}
function uninstallPlatform(platform, repoPath) {
    const files = PLATFORM_CONFIG_FILES[platform];
    const blockRe = new RegExp(`\\n?${MONOMIND_BLOCK_START}[\\s\\S]*?${MONOMIND_BLOCK_END}\\n?`, 'g');
    const cleaned = [];
    for (const relPath of files) {
        const fullPath = join(repoPath, relPath);
        if (!existsSync(fullPath))
            continue;
        const content = readFileSync(fullPath, 'utf8');
        writeFileSync(fullPath, content.replace(blockRe, ''), 'utf8');
        cleaned.push(relPath);
    }
    return cleaned;
}
async function handleInstall(ctx) {
    const platform = ctx.flags['platform'];
    const all = ctx.flags['all'];
    const repoPath = ctx.flags['path'] ?? '.';
    if (!platform && !all) {
        output.error('Specify --platform <name> or --all');
        output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
        return { success: false, exitCode: 1 };
    }
    const targets = all
        ? [...SUPPORTED_PLATFORMS]
        : [platform];
    const invalid = targets.filter(p => !SUPPORTED_PLATFORMS.includes(p));
    if (invalid.length > 0) {
        output.error(`Unknown platform(s): ${invalid.join(', ')}`);
        output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
        return { success: false, exitCode: 1 };
    }
    let totalFiles = 0;
    for (const p of targets) {
        const written = installPlatform(p, repoPath);
        if (written.length > 0) {
            output.success(`[${p}] Installed Monograph context → ${written.join(', ')}`);
            totalFiles += written.length;
        }
        else {
            output.info(`[${p}] Already installed — skipped`);
        }
    }
    output.success(`Done. ${totalFiles} file(s) updated.`);
    return { success: true };
}
async function handleUninstall(ctx) {
    const platform = ctx.flags['platform'];
    const all = ctx.flags['all'];
    const repoPath = ctx.flags['path'] ?? '.';
    if (!platform && !all) {
        output.error('Specify --platform <name> or --all');
        output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
        return { success: false, exitCode: 1 };
    }
    const targets = all
        ? [...SUPPORTED_PLATFORMS]
        : [platform];
    const invalid = targets.filter(p => !SUPPORTED_PLATFORMS.includes(p));
    if (invalid.length > 0) {
        output.error(`Unknown platform(s): ${invalid.join(', ')}`);
        output.info(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
        return { success: false, exitCode: 1 };
    }
    let totalFiles = 0;
    for (const p of targets) {
        const cleaned = uninstallPlatform(p, repoPath);
        if (cleaned.length > 0) {
            output.success(`[${p}] Removed Monograph context from ${cleaned.join(', ')}`);
            totalFiles += cleaned.length;
        }
        else {
            output.info(`[${p}] Nothing to remove — skipped`);
        }
    }
    output.success(`Done. ${totalFiles} file(s) cleaned.`);
    return { success: true };
}
const platformOptions = [
    {
        name: 'platform',
        description: `Target platform (${SUPPORTED_PLATFORMS.join(', ')})`,
        type: 'string',
    },
    {
        name: 'all',
        description: 'Apply to all 14 supported platforms',
        type: 'boolean',
        default: false,
    },
    {
        name: 'path',
        description: 'Path to the repository root (default: current directory)',
        type: 'string',
        default: '.',
    },
];
export const platformsCommand = {
    name: 'platforms',
    description: 'Install or uninstall Monograph context instructions for AI coding platforms',
    subcommands: [
        {
            name: 'install',
            description: 'Inject Monograph knowledge-graph instructions into platform config file(s)',
            options: platformOptions,
            examples: [
                { command: 'monomind platforms install --platform claude', description: 'Install for Claude' },
                { command: 'monomind platforms install --all', description: 'Install for all 14 platforms' },
                { command: 'monomind platforms install --platform cursor --path /path/to/repo', description: 'Install for Cursor in a specific repo' },
            ],
            action: handleInstall,
        },
        {
            name: 'uninstall',
            description: 'Remove Monograph knowledge-graph instructions from platform config file(s)',
            options: platformOptions,
            examples: [
                { command: 'monomind platforms uninstall --platform claude', description: 'Uninstall for Claude' },
                { command: 'monomind platforms uninstall --all', description: 'Uninstall from all 14 platforms' },
            ],
            action: handleUninstall,
        },
    ],
    examples: [
        { command: 'monomind platforms install --all', description: 'Install Monograph context for all platforms' },
        { command: 'monomind platforms uninstall --platform cursor', description: 'Remove context from Cursor config' },
    ],
};
//# sourceMappingURL=platforms.js.map