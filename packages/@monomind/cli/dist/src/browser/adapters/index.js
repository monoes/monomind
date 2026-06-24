const registry = new Map();
export function registerAdapter(adapter) {
    registry.set(adapter.platform, adapter);
}
export function getAdapter(platform) {
    const adapter = registry.get(platform);
    if (!adapter)
        throw new Error(`Unknown platform: ${platform}. Available: ${[...registry.keys()].join(', ')}`);
    return adapter;
}
export function listAdapters() {
    return [...registry.values()];
}
// Auto-register all adapters
import { linkedinAdapter } from './linkedin.js';
import { instagramAdapter } from './instagram.js';
import { xAdapter } from './x.js';
import { geminiAdapter } from './gemini.js';
registerAdapter(linkedinAdapter);
registerAdapter(instagramAdapter);
registerAdapter(xAdapter);
registerAdapter(geminiAdapter);
//# sourceMappingURL=index.js.map