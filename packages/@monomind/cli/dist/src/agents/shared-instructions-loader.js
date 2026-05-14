import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const DEFAULT_PATH = '.agents/shared_instructions.md';
export class SharedInstructionsLoader {
    cache = null;
    filePath;
    constructor(filePath) {
        this.filePath = filePath ?? DEFAULT_PATH;
    }
    load(basePath) {
        const fullPath = basePath ? resolve(basePath, this.filePath) : this.filePath;
        if (!existsSync(fullPath)) {
            this.cache = '';
            return '';
        }
        this.cache = readFileSync(fullPath, 'utf-8');
        return this.cache;
    }
    getSharedInstructions(basePath) {
        if (this.cache !== null)
            return this.cache;
        return this.load(basePath);
    }
    reload(basePath) {
        this.cache = null;
        return this.load(basePath);
    }
    isLoaded() {
        return this.cache !== null;
    }
    /** Prepend shared instructions to an agent prompt with separator */
    prependToPrompt(agentPrompt, basePath) {
        const shared = this.getSharedInstructions(basePath);
        if (!shared)
            return agentPrompt;
        return `${shared}\n\n---\n\n${agentPrompt}`;
    }
}
export const sharedInstructionsLoader = new SharedInstructionsLoader();
//# sourceMappingURL=shared-instructions-loader.js.map