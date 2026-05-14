/**
 * GitStateProvider — injects current git branch, recent log, and changed files
 * into the assembled prompt.  Falls back gracefully when not inside a git repo.
 */
import { execSync } from 'child_process';
import { BaseContextProvider } from './context-provider.js';
export class GitStateProvider extends BaseContextProvider {
    name = 'git-state';
    priority = 60;
    maxTokens = 300;
    async provide(ctx) {
        try {
            const cwd = ctx.workingDir ?? process.cwd();
            const opts = { cwd, encoding: 'utf-8', timeout: 5000 };
            const branch = execSync('git branch --show-current', opts).trim();
            const log = execSync('git log --oneline -5', opts).trim();
            const changed = execSync('git diff --name-only HEAD', opts).trim();
            const parts = [
                `**Branch:** ${branch}`,
                '',
                '**Recent commits:**',
                log,
            ];
            if (changed) {
                parts.push('', '**Changed files:**', changed);
            }
            return this.truncateToTokens(parts.join('\n'), this.maxTokens);
        }
        catch {
            return 'Git state unavailable (not a git repository or git not installed).';
        }
    }
}
//# sourceMappingURL=git-state-provider.js.map