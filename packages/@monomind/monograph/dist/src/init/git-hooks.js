// Detect git hooks manager and install/uninstall a pre-commit monograph gate.
const MANAGED_BLOCK_START = '# monograph-gate-start';
const MANAGED_BLOCK_END = '# monograph-gate-end';
/** Detect which hooks manager is active in the project. */
export function detectHooksManager(rootFiles) {
    if (rootFiles.some(f => f.includes('.husky/')))
        return 'husky';
    if (rootFiles.some(f => f.includes('lefthook.yml') || f.includes('lefthook.yaml')))
        return 'lefthook';
    if (rootFiles.some(f => f.includes('.git/hooks/')))
        return 'raw';
    return 'none';
}
/** Validate a branch name against shell injection. */
export function validateBranchName(branch) {
    return /^[a-zA-Z0-9/_.\-]+$/.test(branch) && !branch.includes('..') && branch.length < 256;
}
/** Generate the pre-commit hook script content. */
export function renderedHookScript(opts) {
    const branch = opts.branch ?? 'main';
    const cmd = opts.command ?? 'npx monograph check';
    return [
        '#!/bin/sh',
        MANAGED_BLOCK_START,
        `BASE=$(git merge-base HEAD ${branch} 2>/dev/null || echo "")`,
        `if [ -n "$BASE" ]; then`,
        `  ${cmd} --since "$BASE"`,
        `else`,
        `  ${cmd}`,
        `fi`,
        MANAGED_BLOCK_END,
    ].join('\n');
}
/** Build the hook content by merging with existing content (idempotent). */
export function mergeHookContent(existing, script) {
    const startIdx = existing.indexOf(MANAGED_BLOCK_START);
    const endIdx = existing.indexOf(MANAGED_BLOCK_END);
    if (startIdx !== -1 && endIdx !== -1) {
        return existing.slice(0, startIdx) + script + existing.slice(endIdx + MANAGED_BLOCK_END.length);
    }
    return existing ? existing + '\n' + script : script;
}
/** Remove the managed block from hook content. */
export function removeHookBlock(content) {
    const startIdx = content.indexOf(MANAGED_BLOCK_START);
    const endIdx = content.indexOf(MANAGED_BLOCK_END);
    if (startIdx === -1 || endIdx === -1)
        return content;
    return content.slice(0, startIdx).trimEnd() + content.slice(endIdx + MANAGED_BLOCK_END.length);
}
export const GIT_HOOK_INSTALL_RESULT_NONE = {
    manager: 'none', installed: false, hookPath: '', message: 'No hooks manager detected',
};
//# sourceMappingURL=git-hooks.js.map