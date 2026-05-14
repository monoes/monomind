/**
 * ProjectConventionsProvider — loads project-level conventions (e.g. from
 * CLAUDE.md or a config file) and injects them as a required context section.
 */
import { BaseContextProvider } from './context-provider.js';
export class ProjectConventionsProvider extends BaseContextProvider {
    loader;
    name = 'project-conventions';
    priority = 100;
    required = true;
    constructor(loader) {
        super();
        this.loader = loader;
    }
    async provide(_ctx) {
        return this.loader();
    }
}
//# sourceMappingURL=project-conventions-provider.js.map