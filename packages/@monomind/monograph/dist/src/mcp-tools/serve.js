import { startServer, isServerRunning, getActiveUrl } from '../web/server.js';
/**
 * Start the Monograph web UI server.
 * If the server is already running, returns the existing URL.
 */
export async function serveMonograph(options) {
    const { port = 7374, open = false, db } = options;
    if (isServerRunning()) {
        const url = getActiveUrl() ?? `http://localhost:${port}`;
        return { url, status: 'already_running' };
    }
    const handle = await startServer({ port, db });
    if (open) {
        // Use spawn with an argument array to avoid shell injection via URL characters
        const { spawn } = await import('child_process');
        const [bin, ...args] = process.platform === 'win32'
            ? ['cmd', '/c', 'start', '', handle.url]
            : process.platform === 'darwin'
                ? ['open', handle.url]
                : ['xdg-open', handle.url];
        spawn(bin, args, { stdio: 'ignore', detached: true }).unref();
    }
    return { url: handle.url, status: 'started' };
}
//# sourceMappingURL=serve.js.map