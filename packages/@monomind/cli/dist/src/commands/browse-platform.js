import { output } from '../output.js';
const SUPPORTED_PLATFORMS = ['linkedin', 'instagram', 'x', 'gemini'];
const connectSubcommand = {
    name: 'connect',
    description: 'Open browser, log in to a platform, save session',
    options: [
        { name: 'port', type: 'number', description: 'CDP port', default: 9222 },
    ],
    action: async (ctx) => {
        const platform = ctx.args[0];
        if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
            output.printError(`Platform required: ${SUPPORTED_PLATFORMS.join(', ')}`);
            return { success: false, exitCode: 1 };
        }
        const { getAdapter } = await import('../browser/adapters/index.js');
        const { saveSession } = await import('../browser/workflow/store.js');
        const browser = await import('@monoes/monobrowse');
        const adapter = getAdapter(platform);
        const port = ctx.flags.port ?? 9222;
        output.printInfo(`Opening browser → navigating to ${adapter.loginURL()}`);
        output.printInfo('Please log in. Detection is automatic — checking every 2s...');
        const cdpPort = await browser.launchBrowser({ port, headless: false });
        const { client, sessionId } = await browser.connectToTarget(cdpPort);
        const cdpClient = client;
        await cdpClient.send('Page.navigate', { url: adapter.loginURL() }, sessionId);
        const page = {
            client: cdpClient, sessionId,
            async evaluate(fn) {
                const result = await cdpClient.send('Runtime.evaluate', { expression: fn, returnByValue: true }, sessionId);
                return result.result.value;
            },
            async url() {
                const result = await cdpClient.send('Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }, sessionId);
                return result.result.value;
            },
        };
        // Poll for login
        let loggedIn = false;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            loggedIn = await adapter.isLoggedIn(page).catch(() => false);
            if (loggedIn)
                break;
            process.stdout.write('.');
        }
        process.stdout.write('\n');
        if (!loggedIn) {
            output.printError('Login not detected after 60s. Please try again.');
            client.close();
            return { success: false, exitCode: 1 };
        }
        const username = await adapter.extractUsername(page).catch(() => 'unknown');
        const cookieResult = await cdpClient.send('Network.getAllCookies', {}, sessionId);
        const cookies = JSON.stringify(cookieResult.cookies);
        const sessionId_ = `${platform}:${username}`;
        await saveSession({ id: sessionId_, platform, username, cookies });
        output.printSuccess(`Connected ${platform} as ${username} (session saved)`);
        cdpClient.close();
        return { success: true };
    },
};
const listSubcommand = {
    name: 'list',
    aliases: ['ls'],
    description: 'List connected platform accounts',
    action: async () => {
        const { listSessions } = await import('../browser/workflow/store.js');
        const sessions = await listSessions();
        if (sessions.length === 0) {
            output.printInfo('No connected accounts. Use: monomind browse platform connect <platform>');
            return { success: true };
        }
        output.printTable({
            columns: [
                { key: 'platform', header: 'Platform', width: 12 },
                { key: 'username', header: 'Username', width: 25 },
                { key: 'lastUsedAt', header: 'Last Used', width: 20,
                    format: (v) => new Date(v).toLocaleString() },
                { key: 'id', header: 'Session ID', width: 30 },
            ],
            data: sessions,
        });
        return { success: true };
    },
};
const disconnectSubcommand = {
    name: 'disconnect',
    description: 'Remove a saved platform session',
    action: async (ctx) => {
        const sessionId = ctx.args[0];
        if (!sessionId) {
            output.printError('Session ID required. Use "monomind browse platform list" to see IDs.');
            return { success: false, exitCode: 1 };
        }
        const { deleteSession } = await import('../browser/workflow/store.js');
        await deleteSession(sessionId);
        output.printSuccess(`Session removed: ${sessionId}`);
        return { success: true };
    },
};
export const browsePlatformCommand = {
    name: 'platform',
    description: 'Manage platform connections (linkedin, instagram, x, gemini)',
    subcommands: [connectSubcommand, listSubcommand, disconnectSubcommand],
    action: async () => {
        output.writeln(output.bold('browse platform — usage:'));
        output.printList([
            'monomind browse platform connect <platform>',
            'monomind browse platform list',
            'monomind browse platform disconnect <session-id>',
        ]);
        output.writeln(`\nPlatforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
        return { success: true };
    },
};
export default browsePlatformCommand;
//# sourceMappingURL=browse-platform.js.map