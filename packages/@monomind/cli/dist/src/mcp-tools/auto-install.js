/**
 * Auto-install utility for optional MCP tool dependencies
 *
 * When an MCP tool requires an optional package that isn't installed,
 * this utility attempts to install it automatically on first use.
 */
import { spawnSync } from 'child_process';
// Track which packages we've attempted to install this session
const installAttempts = new Set();
/**
 * Auto-install a package if not available
 *
 * @param packageName - npm package name to install
 * @param options - Installation options
 * @returns true if installed successfully or already attempted
 */
export async function autoInstallPackage(packageName, options = {}) {
    const { timeout = 60000, save = false, silent = false } = options;
    // Validate package name to prevent command injection (CVE fix)
    // Valid npm package names: @scope/name or name, alphanumeric with - . _ ~
    const validPackageName = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9-._~]+)?$/i;
    if (!validPackageName.test(packageName)) {
        if (!silent) {
            console.error(`[monomind] Invalid package name: ${packageName}`);
        }
        return false;
    }
    // Only attempt once per session
    if (installAttempts.has(packageName)) {
        return false;
    }
    installAttempts.add(packageName);
    try {
        if (!silent) {
            console.error(`[monomind] Auto-installing ${packageName}...`);
        }
        // Use spawn with array args to prevent shell injection
        const args = ['install', packageName, save ? '--save' : '--no-save'];
        const result = spawnSync('npm', args, {
            stdio: silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
            timeout,
            shell: false, // Explicitly disable shell
        });
        if (result.status !== 0) {
            throw new Error(result.stderr?.toString() || 'Installation failed');
        }
        if (!silent) {
            console.error(`[monomind] Successfully installed ${packageName}`);
        }
        return true;
    }
    catch (error) {
        if (!silent) {
            console.error(`[monomind] Failed to auto-install ${packageName}: ${error}`);
        }
        return false;
    }
}
/**
 * Try to import a package, auto-install if not found, and retry
 *
 * @param packageName - npm package name
 * @param options - Installation options
 * @returns The imported module or null if failed
 */
export async function tryImportOrInstall(packageName, options = {}) {
    try {
        // First try to import
        return await import(packageName);
    }
    catch {
        // Package not found, try to install
        const installed = await autoInstallPackage(packageName, options);
        if (installed) {
            try {
                return await import(packageName);
            }
            catch {
                // ESM module cache cannot be busted programmatically; a server restart is required
                console.error(`[monomind] ${packageName} installed but failed to load. Restart MCP server.`);
                return null;
            }
        }
        return null;
    }
}
/**
 * Check if a package is available without installing
 */
export async function isPackageAvailable(packageName) {
    try {
        await import(packageName);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Reset install attempts (useful for testing)
 */
export function resetInstallAttempts() {
    installAttempts.clear();
}
/**
 * Optional package dependencies and their purposes
 */
export const OPTIONAL_PACKAGES = {
    '@monomind/aidefence': {
        description: 'AI manipulation defense (prompt injection, PII detection)',
        tools: ['aidefence_scan', 'aidefence_analyze', 'aidefence_stats', 'aidefence_learn'],
    },
    '@monomind/embeddings': {
        description: 'Vector embeddings with ONNX support',
        tools: ['embeddings_generate', 'embeddings_search', 'embeddings_batch'],
    },
    'onnxruntime-node': {
        description: 'ONNX runtime for neural network inference',
        tools: ['neural_*'],
    },
};
export default {
    autoInstallPackage,
    tryImportOrInstall,
    isPackageAvailable,
    resetInstallAttempts,
    OPTIONAL_PACKAGES,
};
//# sourceMappingURL=auto-install.js.map