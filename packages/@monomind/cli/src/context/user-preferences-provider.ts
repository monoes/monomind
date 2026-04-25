/**
 * UserPreferencesProvider — fetches user-level preferences for the active
 * session and formats them as a bullet list for injection into the prompt.
 */

import { BaseContextProvider, type RunContext } from './context-provider.js';

export type PreferencesGetter = (
  sessionId: string,
) => Promise<Record<string, string>>;

export class UserPreferencesProvider extends BaseContextProvider {
  readonly name = 'user-preferences' as const;
  readonly priority = 90;

  constructor(private readonly getter: PreferencesGetter) {
    super();
  }

  async provide(ctx: RunContext): Promise<string> {
    const prefs = await this.getter(ctx.sessionId);
    const entries = Object.entries(prefs);

    if (entries.length === 0) {
      return '';
    }

    const lines: string[] = ['**User preferences:**'];
    for (const [key, value] of entries) {
      lines.push(`- ${key}: ${value}`);
    }

    return this.truncateToTokens(lines.join('\n'), this.maxTokens);
  }
}
