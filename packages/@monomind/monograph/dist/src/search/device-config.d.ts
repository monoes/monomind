export type EmbedDevice = 'cpu' | 'cuda' | 'mps';
export interface EmbedDeviceConfig {
    device?: EmbedDevice;
    threads?: number;
}
/**
 * Resolves the compute device to use for local embedders.
 *
 * Priority:
 *  1. Explicit `config.device` if provided
 *  2. 'mps' on macOS (darwin) when not explicitly overridden
 *  3. 'cuda' when CUDA_VISIBLE_DEVICES env var is set (non-empty)
 *  4. 'cpu' as fallback
 */
export declare function resolveDevice(config?: EmbedDeviceConfig): EmbedDevice;
//# sourceMappingURL=device-config.d.ts.map