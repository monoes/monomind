/**
 * WASM Sandbox - Node.js vm-based sandboxed JS execution
 *
 * Uses Node's vm module to run JavaScript in an isolated context.
 * Blocks access to require, process, setTimeout, setInterval, and other
 * host environment globals.
 *
 * @module v1/security/sandbox/wasm-sandbox
 */
import vm from 'node:vm';
/**
 * Creates a WasmSandbox runtime for an agent.
 */
export function create(agentId, config) {
    const defaultTimeout = config.timeout_ms ?? 5000;
    return {
        type: 'wasm',
        agentId,
        async execute(code, timeoutMs) {
            const timeout = timeoutMs ?? defaultTimeout;
            const stdoutLines = [];
            const stderrLines = [];
            // Build a minimal sandbox context that blocks dangerous globals
            const sandbox = {
                console: {
                    log: (...args) => {
                        stdoutLines.push(args.map(String).join(' '));
                    },
                    error: (...args) => {
                        stderrLines.push(args.map(String).join(' '));
                    },
                    warn: (...args) => {
                        stderrLines.push(args.map(String).join(' '));
                    },
                    info: (...args) => {
                        stdoutLines.push(args.map(String).join(' '));
                    },
                },
                // Explicitly block dangerous APIs
                require: undefined,
                process: undefined,
                setTimeout: undefined,
                setInterval: undefined,
                setImmediate: undefined,
                clearTimeout: undefined,
                clearInterval: undefined,
                clearImmediate: undefined,
                globalThis: undefined,
                global: undefined,
            };
            const context = vm.createContext(sandbox);
            try {
                vm.runInContext(code, context, {
                    timeout,
                    filename: `sandbox-${agentId}.js`,
                });
                return {
                    code: 0,
                    stdout: stdoutLines.join('\n'),
                    stderr: stderrLines.join('\n'),
                    timedOut: false,
                };
            }
            catch (err) {
                const error = err;
                // Node vm throws an error with code 'ERR_SCRIPT_EXECUTION_TIMEOUT' on timeout
                if (error.message?.includes('Script execution timed out') ||
                    error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
                    return {
                        code: 124,
                        stdout: stdoutLines.join('\n'),
                        stderr: 'Execution timed out',
                        timedOut: true,
                    };
                }
                return {
                    code: 1,
                    stdout: stdoutLines.join('\n'),
                    stderr: error.message ?? String(err),
                    timedOut: false,
                };
            }
        },
        async destroy() {
            // No persistent resources to clean up for vm-based sandbox
        },
        async getStats() {
            return {
                type: 'wasm',
                agentId,
                memoryPages: config.wasm_memory_pages ?? 256,
            };
        },
    };
}
//# sourceMappingURL=wasm-sandbox.js.map