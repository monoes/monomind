/**
 * Resolves the compute device to use for local embedders.
 *
 * Priority:
 *  1. Explicit `config.device` if provided
 *  2. 'mps' on macOS (darwin) when not explicitly overridden
 *  3. 'cuda' when CUDA_VISIBLE_DEVICES env var is set (non-empty)
 *  4. 'cpu' as fallback
 */
export function resolveDevice(config) {
    if (config?.device) {
        return config.device;
    }
    if (process.platform === 'darwin') {
        return 'mps';
    }
    if (process.env['CUDA_VISIBLE_DEVICES']) {
        return 'cuda';
    }
    return 'cpu';
}
//# sourceMappingURL=device-config.js.map