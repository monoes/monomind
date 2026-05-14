/**
 * Statusline Configuration Generator (Optimized)
 * Creates fast, reliable statusline for V1 progress display
 *
 * Performance:
 * - Single combined git execSync call (not 8+ separate ones)
 * - process.memoryUsage() instead of ps aux
 * - No recursive test file content reading
 * - Shared settings cache
 * - Strict 2s timeouts on all shell calls
 */
import type { InitOptions } from './types.js';
/**
 * Generate optimized statusline script
 * Output format:
 * ▊ Monomind ● user  │  ⎇ branch  │  Opus 4.6 (1M context)
 * ─────────────────────────────────────────────────────
 * 🏗️  DDD Domains    [●●○○○]  2/5    ⚡ HNSW 150x
 * 🤖 Swarm  ◉ [ 5/15]  👥 2    🪝 10/17    🟢 CVE 3/3    💾 4MB    🧠  63%
 * 🔧 Architecture    ADRs ●71%  │  DDD ● 13%  │  Security ●CLEAN
 * 📊 AgentDB    Vectors ●3104⚡  │  Size 216KB  │  Tests ●6 (~24 cases)  │  MCP ●1/1
 */
export declare function generateStatuslineScript(options: InitOptions): string;
export declare function generateStatuslineHook(options: InitOptions): string;
//# sourceMappingURL=statusline-generator.d.ts.map