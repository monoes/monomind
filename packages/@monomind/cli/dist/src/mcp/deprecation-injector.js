/**
 * Deprecation Injector (Task 31)
 *
 * Injects deprecation warnings into MCP tool responses when the
 * invoked tool has been marked as deprecated in the ToolRegistry.
 */
/**
 * Injects deprecation metadata into MCP responses.
 */
export class DeprecationInjector {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    /**
     * If `toolName` is deprecated, augment the response with a warning.
     *
     * Returns the original response unmodified when the tool is not
     * deprecated. When deprecated, adds `_deprecation` metadata.
     *
     * Warning format:
     *   [DEPRECATED] Tool "<name>" is deprecated. <message>. Use "<successor>" instead.
     */
    inject(response, toolName) {
        const tool = this.registry.getVersion(toolName);
        if (!tool || !tool.deprecated) {
            return response;
        }
        const parts = [`[DEPRECATED] Tool "${toolName}" is deprecated.`];
        if (tool.deprecationMessage) {
            parts.push(tool.deprecationMessage + '.');
        }
        if (tool.successor) {
            parts.push(`Use "${tool.successor}" instead.`);
        }
        const warning = parts.join(' ');
        return {
            ...response,
            _deprecation: {
                warning,
                deprecated: true,
                successor: tool.successor ?? null,
                deprecatedAt: tool.deprecatedAt ?? null,
            },
        };
    }
}
//# sourceMappingURL=deprecation-injector.js.map