export const codeCapability = {
    name: 'code',
    detect(scan) {
        return scan.capabilities.code.confidence;
    },
    async activate(_rootDir) {
        // monolean: no-op — existing init/monograph handles code projects
        // This module exists so the manager can track code as a capability
    },
    async index(_files) {
        // monolean: existing monograph handles code indexing
        return { indexed: 0, skipped: 0, errors: [] };
    },
    async healthChecks() {
        // monolean: delegates to existing doctor checks when cap/code is active
        // The doctor command checks isActive('code') to decide which checks to run
        return [];
    },
};
//# sourceMappingURL=cap-code.js.map