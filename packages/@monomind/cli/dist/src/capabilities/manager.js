import fs from 'fs';
import path from 'path';
const ACTIVATION_THRESHOLD = 0.1;
const CROSS_CUTTING = new Set(['graph', 'timeline']);
const CONTENT_CAPS = new Set(['code', 'documents', 'media', 'data']);
export class CapabilityManager {
    registry = new Map();
    active = new Map();
    register(module) {
        this.registry.set(module.name, module);
    }
    async activateFromScan(scan, rootDir, save = true) {
        this.active.clear();
        // Activate content capabilities above threshold
        for (const [name, module] of this.registry) {
            if (CROSS_CUTTING.has(name))
                continue;
            const confidence = module.detect(scan);
            if (confidence >= ACTIVATION_THRESHOLD) {
                await module.activate(rootDir);
                this.active.set(name, module);
            }
        }
        // Activate cross-cutting if 2+ content caps are active
        const activeContentCount = [...this.active.keys()].filter(n => CONTENT_CAPS.has(n)).length;
        if (activeContentCount >= 2) {
            for (const name of CROSS_CUTTING) {
                const module = this.registry.get(name);
                if (module) {
                    await module.activate(rootDir);
                    this.active.set(name, module);
                }
            }
        }
        if (save) {
            this.saveCapabilities(rootDir);
        }
    }
    saveCapabilities(rootDir) {
        const monomindDir = path.join(rootDir, '.monomind');
        const capsPath = path.join(monomindDir, 'capabilities.json');
        try {
            fs.mkdirSync(monomindDir, { recursive: true });
            const tmpPath = capsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify({ active: [...this.active.keys()] }, null, 2));
            fs.renameSync(tmpPath, capsPath);
        }
        catch {
            // best-effort persistence; activation state still holds in-memory
        }
    }
    isActive(name) {
        return this.active.has(name);
    }
    getActive() {
        return [...this.active.values()];
    }
    async runHealthChecks() {
        const results = [];
        for (const module of this.active.values()) {
            if (module.healthChecks) {
                results.push(...await module.healthChecks());
            }
        }
        return results;
    }
    async search(query, limit = 20) {
        const allResults = [];
        for (const module of this.active.values()) {
            if (module.search) {
                allResults.push(...await module.search(query, limit));
            }
        }
        return allResults.sort((a, b) => b.score - a.score).slice(0, limit);
    }
}
//# sourceMappingURL=manager.js.map