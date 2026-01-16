/**
 * EpisodeBinnerWorker — Hooks into PostTask and SessionEnd to accumulate
 * agent runs into episodic memory and close episodes at session boundaries.
 *
 * @module v1/hooks/workers/episode-binner
 */

import { HookEvent, HookPriority } from '../types.js';
import type { HookContext } from '../types.js';
import { registerHook } from '../registry/index.js';
import type { EpisodicStore } from '../../../memory/src/episodic-store.js';

export class EpisodeBinnerWorker {
  constructor(private store: EpisodicStore) {}

  /**
   * Register PostTask and SessionEnd hooks with the default registry.
   */
  register(): void {
    registerHook(
      HookEvent.PostTask,
      async (ctx: HookContext) => {
        const taskId = ctx.task?.id ?? 'unknown';
        const agentSlug = ctx.agent?.type ?? ctx.task?.agent ?? 'unknown';
        const taskType = ctx.task?.status ?? 'task';
        const content = ctx.task?.description ?? '';
        const sessionId = ctx.session?.id;

        await this.store.addRun(taskId, agentSlug, taskType, content, sessionId);

        return { success: true };
      },
      HookPriority.Low,
      { name: 'episode-binner:post-task' },
    );

    registerHook(
      HookEvent.SessionEnd,
      async (_ctx: HookContext) => {
        await this.store.closeEpisode();
        return { success: true };
      },
      HookPriority.Low,
      { name: 'episode-binner:session-end' },
    );
  }
}
