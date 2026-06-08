/**
 * Security Hook — MonoDefence integration with the Monomind hooks system.
 *
 * Registers two Critical-priority hooks on the supplied registry:
 *   - pre-task    : scans the task description for prompt-injection / jailbreak.
 *   - pre-command : scans the raw command string before execution.
 *
 * Both hooks abort when a threat is detected with confidence >= 0.8.
 *
 * Usage (called once at startup by the hooks executor):
 *   import { registerSecurityHooks } from '@monomind/monodefence/hooks';
 *   registerSecurityHooks(defaultRegistry);
 *
 * The function accepts any object whose `register` signature is compatible
 * with HookRegistry — no hard compile-time dependency on @monomind/hooks.
 */

/** Minimal hook context shape — mirrors HookContext from @monomind/hooks */
interface MinimalHookContext {
  event: string;
  timestamp: Date;
  task?: { id: string; description: string; agent?: string; status?: string };
  command?: { raw: string; workingDirectory?: string };
  [key: string]: unknown;
}

/** Minimal hook result shape — mirrors HookResult from @monomind/hooks */
interface MinimalHookResult {
  success: boolean;
  abort?: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
  data?: Record<string, unknown>;
}

/** Minimal registry interface — only the `register` method is needed */
interface MinimalRegistry {
  register(
    event: string,
    handler: (context: MinimalHookContext) => Promise<MinimalHookResult> | MinimalHookResult,
    priority: number,
    options?: { name?: string; description?: string; enabled?: boolean; metadata?: Record<string, unknown> }
  ): string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Confidence threshold above which a detected threat aborts execution. */
const ABORT_THRESHOLD = 0.8;

/** Mirrors HookPriority.Critical = 1000 from @monomind/hooks */
const PRIORITY_CRITICAL = 1000;

// ── Lazy defence factory ─────────────────────────────────────────────────────

/**
 * Lazily imports and returns the default MonoDefence singleton.
 * Lazy import avoids circular-dep issues and keeps this module side-effect-free
 * until registerSecurityHooks() is actually invoked.
 */
async function getDefence() {
  const { getMonoDefence } = await import('../index.js');
  return getMonoDefence();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register MonoDefence security hooks on the supplied registry.
 *
 * @param registry - Any object compatible with HookRegistry.register
 * @returns The generated hook IDs for both registered hooks
 */
export function registerSecurityHooks(
  registry: MinimalRegistry
): { preTaskId: string; preCommandId: string } {

  // ── pre-task hook ──────────────────────────────────────────────────────────
  const preTaskId = registry.register(
    'pre-task',
    async (context: MinimalHookContext): Promise<MinimalHookResult> => {
      const input = context.task?.description ?? '';
      if (!input) {
        return { success: true };
      }

      try {
        const d = await getDefence();
        const result = await d.detect(input);

        if (!result.safe && result.threats.length > 0) {
          const worst = result.threats.reduce(
            (max, t) => (t.confidence > max.confidence ? t : max),
            result.threats[0]
          );

          if (worst.confidence >= ABORT_THRESHOLD) {
            return {
              success: false,
              abort: true,
              error: `[MonoDefence] Threat detected in task — ${worst.type} (confidence ${(worst.confidence * 100).toFixed(0)}%)`,
              message: `Task blocked by MonoDefence: ${worst.description}`,
            };
          }

          // Below threshold — warn but allow through
          return {
            success: true,
            warnings: result.threats.map(
              (t) =>
                `[MonoDefence] Low-confidence threat in task: ${t.type} (${(t.confidence * 100).toFixed(0)}%)`
            ),
          };
        }
      } catch {
        // Detection errors must never block legitimate tasks
      }

      return { success: true };
    },
    PRIORITY_CRITICAL,
    {
      name: 'monodefence:pre-task',
      description: 'Scans task descriptions for prompt injection and jailbreak attempts',
    }
  );

  // ── pre-command hook ───────────────────────────────────────────────────────
  const preCommandId = registry.register(
    'pre-command',
    async (context: MinimalHookContext): Promise<MinimalHookResult> => {
      const input = context.command?.raw ?? '';
      if (!input) {
        return { success: true };
      }

      try {
        const d = await getDefence();
        const result = await d.detect(input);

        if (!result.safe && result.threats.length > 0) {
          const worst = result.threats.reduce(
            (max, t) => (t.confidence > max.confidence ? t : max),
            result.threats[0]
          );

          if (worst.confidence >= ABORT_THRESHOLD) {
            return {
              success: false,
              abort: true,
              error: `[MonoDefence] Threat detected in command — ${worst.type} (confidence ${(worst.confidence * 100).toFixed(0)}%)`,
              message: `Command blocked by MonoDefence: ${worst.description}`,
            };
          }

          return {
            success: true,
            warnings: result.threats.map(
              (t) =>
                `[MonoDefence] Low-confidence threat in command: ${t.type} (${(t.confidence * 100).toFixed(0)}%)`
            ),
          };
        }
      } catch {
        // Detection errors must never block legitimate commands
      }

      return { success: true };
    },
    PRIORITY_CRITICAL,
    {
      name: 'monodefence:pre-command',
      description: 'Scans command strings for prompt injection and encoding attacks',
    }
  );

  return { preTaskId, preCommandId };
}
