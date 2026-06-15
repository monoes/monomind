/**
 * CLI Replay Command (Task 14)
 * Session replay and inspection
 */
import { output } from '../output.js';
const showSubcommand = {
    name: 'show',
    description: 'Show replay for a session',
    options: [
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        const sessionId = ctx.args[0];
        if (!sessionId) {
            output.error('Session ID is required: replay show <sessionId>');
            return { success: false, message: 'Missing session ID' };
        }
        try {
            const { ReplayReader } = await import('../observability/replay-reader.js');
            const reader = new ReplayReader();
            const data = await reader.show(sessionId);
            const asJson = ctx.flags['json'];
            output.writeln(asJson ? JSON.stringify(data, null, 2) : `Replay for session ${sessionId}`);
            return { success: true, data };
        }
        catch {
            output.writeln(`No replay data for session ${sessionId}`);
            return { success: true, message: 'No replay data' };
        }
    },
};
const listSubcommand = {
    name: 'list',
    description: 'List available session replays',
    options: [
        { name: 'limit', short: 'n', type: 'number', description: 'Max entries', default: 20 },
        { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    ],
    action: async (ctx) => {
        try {
            const { ReplayReader } = await import('../observability/replay-reader.js');
            const reader = new ReplayReader();
            const rawLimit = ctx.flags['limit'];
            // Cap limit to prevent DoS
            const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
                ? Math.max(1, Math.min(Math.floor(rawLimit), 500))
                : 20;
            const data = await reader.list(limit);
            const asJson = ctx.flags['json'];
            output.writeln(asJson ? JSON.stringify(data, null, 2) : 'Available replays listed');
            return { success: true, data };
        }
        catch {
            output.writeln('No replay sessions available');
            return { success: true, message: 'No sessions' };
        }
    },
};
export const replayCommand = {
    name: 'replay',
    description: 'Session replay and inspection',
    subcommands: [showSubcommand, listSubcommand],
};
export default replayCommand;
//# sourceMappingURL=replay.js.map