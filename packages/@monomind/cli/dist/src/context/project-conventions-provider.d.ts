/**
 * ProjectConventionsProvider — loads project-level conventions (e.g. from
 * CLAUDE.md or a config file) and injects them as a required context section.
 */
import { BaseContextProvider, type RunContext } from './context-provider.js';
export type ConventionsLoader = () => string;
export declare class ProjectConventionsProvider extends BaseContextProvider {
    private readonly loader;
    readonly name: "project-conventions";
    readonly priority = 100;
    readonly required = true;
    constructor(loader: ConventionsLoader);
    provide(_ctx: RunContext): Promise<string>;
}
//# sourceMappingURL=project-conventions-provider.d.ts.map