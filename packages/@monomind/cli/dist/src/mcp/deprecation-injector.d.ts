/**
 * Deprecation Injector (Task 31)
 *
 * Injects deprecation warnings into MCP tool responses when the
 * invoked tool has been marked as deprecated in the ToolRegistry.
 */
import type { ToolRegistry } from './tool-registry.js';
/**
 * Injects deprecation metadata into MCP responses.
 */
export declare class DeprecationInjector {
    private readonly registry;
    constructor(registry: ToolRegistry);
    /**
     * If `toolName` is deprecated, augment the response with a warning.
     *
     * Returns the original response unmodified when the tool is not
     * deprecated. When deprecated, adds `_deprecation` metadata.
     *
     * Warning format:
     *   [DEPRECATED] Tool "<name>" is deprecated. <message>. Use "<successor>" instead.
     */
    inject(response: Record<string, unknown>, toolName: string): Record<string, unknown>;
}
//# sourceMappingURL=deprecation-injector.d.ts.map