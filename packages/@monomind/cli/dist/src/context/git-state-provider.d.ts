/**
 * GitStateProvider — injects current git branch, recent log, and changed files
 * into the assembled prompt.  Falls back gracefully when not inside a git repo.
 */
import { BaseContextProvider, type RunContext } from './context-provider.js';
export declare class GitStateProvider extends BaseContextProvider {
    readonly name: "git-state";
    readonly priority = 60;
    readonly maxTokens = 300;
    provide(ctx: RunContext): Promise<string>;
}
//# sourceMappingURL=git-state-provider.d.ts.map