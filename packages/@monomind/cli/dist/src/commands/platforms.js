/**
 * CLI Platforms Command
 * Install/uninstall Monograph context instructions for 14 AI coding platforms
 *
 * github.com/monoes/monomind
 */
import { existsSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
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
/**
 * Maximum size for a platform config file we will read or append to.
 * Platform config files (CLAUDE.md, .cursorrules, etc.) are never legitimately
 * larger than a few hundred KB — a 1 MB cap prevents OOM when the flag points
 * at an enormous file such as a binary or a DB dump.
 */
const MAX_CONFIG_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
/**
 * Resolve and validate the user-supplied --path flag.
 *
 * SECURITY: the flag is attacker-controlled. Without validation an adversary can
 *   pass --path /etc to overwrite system files, or --path "../../.." to escape
 *   the project. We resolve to an absolute path and reject anything that isn't
 *   a directory (or doesn't exist yet under a parent that does exist).
 *   We do NOT further restrict the path to cwd because a legitimate use case is
 *   "install into another repo at an absolute path", but we do require the
 *   resolved path to be a directory (or the parent to exist) so that the caller
 *   cannot aim the flag at a file.
 */
function resolveRepoPath(rawPath) {
    // Prevent shell-injection via null bytes or unusual separators
    if (rawPath.includes('\0'))
        throw new Error('Invalid path: contains null byte');
    const resolved = resolve(rawPath);
    // If the path exists it must be a directory
    if (existsSync(resolved)) {
        const st = statSync(resolved);
        if (!st.isDirectory())
            throw new Error(`--path must be a directory, got a file: ${resolved}`);
    }
    return resolved;
}
/**
 * Validate that fullPath is contained within repoRoot (path traversal defence).
 * relPath comes from our own PLATFORM_CONFIG_FILES map, but we validate anyway
 * to guard against future changes that introduce dynamic paths.
 */
function assertWithinRoot(fullPath, repoRoot) {
    if (!fullPath.startsWith(repoRoot + '/') && fullPath !== repoRoot) {
        throw new Error(`Path escapes repository root: ${fullPath}`);
    }
}
function installPlatform(platform, repoPath) {
    const files = PLATFORM_CONFIG_FILES[platform];
    const instructions = getMonomindInstructions();
    const written = [];
    for (const relPath of files) {
        const fullPath = resolve(join(repoPath, relPath));
        assertWithinRoot(fullPath, repoPath);
        const dir = dirname(fullPath);
        mkdirSync(dir, { recursive: true });
        if (existsSync(fullPath)) {
            // Guard against reading oversized files (e.g. the flag points at a data file)
            const fileStat = statSync(fullPath);
            if (fileStat.size > MAX_CONFIG_FILE_BYTES) {
                throw new Error(`Config file too large to read (${fileStat.size} bytes): ${relPath}`);
            }
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
        const fullPath = resolve(join(repoPath, relPath));
        assertWithinRoot(fullPath, repoPath);
        if (!existsSync(fullPath))
            continue;
        // Guard against reading oversized files
        const fileStat = statSync(fullPath);
        if (fileStat.size > MAX_CONFIG_FILE_BYTES) {
            throw new Error(`Config file too large to read (${fileStat.size} bytes): ${relPath}`);
        }
        const content = readFileSync(fullPath, 'utf8');
        writeFileSync(fullPath, content.replace(blockRe, ''), 'utf8');
        cleaned.push(relPath);
    }
    return cleaned;
}
async function handleInstall(ctx) {
    const platform = ctx.flags['platform'];
    const all = ctx.flags['all'];
    let repoPath;
    try {
        repoPath = resolveRepoPath(ctx.flags['path'] ?? '.');
    }
    catch (err) {
        output.error(`Invalid --path: ${err instanceof Error ? err.message : String(err)}`);
        return { success: false, exitCode: 1 };
    }
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
        let written;
        try {
            written = installPlatform(p, repoPath);
        }
        catch (err) {
            output.error(`[${p}] Install failed: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
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
    let repoPath;
    try {
        repoPath = resolveRepoPath(ctx.flags['path'] ?? '.');
    }
    catch (err) {
        output.error(`Invalid --path: ${err instanceof Error ? err.message : String(err)}`);
        return { success: false, exitCode: 1 };
    }
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
        let cleaned;
        try {
            cleaned = uninstallPlatform(p, repoPath);
        }
        catch (err) {
            output.error(`[${p}] Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
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