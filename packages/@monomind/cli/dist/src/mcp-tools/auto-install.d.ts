/**
 * Auto-install utility for optional MCP tool dependencies
 *
 * When an MCP tool requires an optional package that isn't installed,
 * this utility attempts to install it automatically on first use.
 */
export interface AutoInstallOptions {
    /**
     * Timeout in milliseconds for npm install (default: 60000)
     */
    timeout?: number;
    /**
     * Whether to save to package.json (default: false)
     */
    save?: boolean;
    /**
     * Silent install (no console output)
     */
    silent?: boolean;
}
/**
 * Auto-install a package if not available
 *
 * @param packageName - npm package name to install
 * @param options - Installation options
 * @returns true if installed successfully or already attempted
 */
export declare function autoInstallPackage(packageName: string, options?: AutoInstallOptions): Promise<boolean>;
/**
 * Try to import a package, auto-install if not found, and retry
 *
 * @param packageName - npm package name
 * @param options - Installation options
 * @returns The imported module or null if failed
 */
export declare function tryImportOrInstall<T = unknown>(packageName: string, options?: AutoInstallOptions): Promise<T | null>;
/**
 * Check if a package is available without installing
 */
export declare function isPackageAvailable(packageName: string): Promise<boolean>;
/**
 * Reset install attempts (useful for testing)
 */
export declare function resetInstallAttempts(): void;
/**
 * Optional package dependencies and their purposes
 */
export declare const OPTIONAL_PACKAGES: {
    readonly 'monofence-ai': {
        readonly description: "AI manipulation defense (prompt injection, PII detection)";
        readonly tools: readonly ["aidefence_scan", "aidefence_analyze", "aidefence_stats", "aidefence_learn"];
    };
    readonly 'onnxruntime-node': {
        readonly description: "ONNX runtime for neural network inference";
        readonly tools: readonly ["neural_*"];
    };
};
declare const _default: {
    autoInstallPackage: typeof autoInstallPackage;
    tryImportOrInstall: typeof tryImportOrInstall;
    isPackageAvailable: typeof isPackageAvailable;
    resetInstallAttempts: typeof resetInstallAttempts;
    OPTIONAL_PACKAGES: {
        readonly 'monofence-ai': {
            readonly description: "AI manipulation defense (prompt injection, PII detection)";
            readonly tools: readonly ["aidefence_scan", "aidefence_analyze", "aidefence_stats", "aidefence_learn"];
        };
        readonly 'onnxruntime-node': {
            readonly description: "ONNX runtime for neural network inference";
            readonly tools: readonly ["neural_*"];
        };
    };
};
export default _default;
//# sourceMappingURL=auto-install.d.ts.map