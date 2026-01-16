/**
 * Messaging module — per-agent-pair conversation threading.
 * @packageDocumentation
 */

export type { AgentId, Message, ThreadStats } from './types.js';
export { ConversationThread } from './conversation-thread.js';
export { ThreadedMessageBus, threadedMessageBus } from './threaded-message-bus.js';
