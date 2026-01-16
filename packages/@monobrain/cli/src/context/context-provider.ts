/**
 * Context Provider — interfaces and base class for dynamic prompt assembly.
 *
 * Each provider contributes a named section of context to the assembled prompt.
 * Providers are prioritised (0-100) and budget-aware via token estimation.
 */

export interface RunContext {
  agentSlug: string;
  taskDescription: string;
  sessionId: string;
  swarmId?: string;
  workingDir?: string;
  metadata: Record<string, unknown>;
}

export interface ContextSection {
  name: string;
  content: string;
  tokenCount: number;
  priority: number;
  required: boolean;
}

export interface ContextProvider {
  readonly name: string;
  readonly priority: number;
  readonly maxTokens: number;
  readonly required: boolean;
  provide(ctx: RunContext): Promise<string>;
}

/**
 * Convenience base class that implements the ContextProvider contract and
 * supplies a rough token-truncation helper (approx 4 chars per token).
 */
export abstract class BaseContextProvider implements ContextProvider {
  abstract readonly name: string;
  abstract readonly priority: number;

  readonly maxTokens: number = 500;
  readonly required: boolean = false;

  /**
   * Truncate `text` so that it fits within `maxTokens` (4 chars/token).
   */
  protected truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars);
  }

  abstract provide(ctx: RunContext): Promise<string>;
}
