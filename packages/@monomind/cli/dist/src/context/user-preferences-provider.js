/**
 * UserPreferencesProvider — fetches user-level preferences for the active
 * session and formats them as a bullet list for injection into the prompt.
 */
import { BaseContextProvider } from './context-provider.js';
export class UserPreferencesProvider extends BaseContextProvider {
    getter;
    name = 'user-preferences';
    priority = 90;
    constructor(getter) {
        super();
        this.getter = getter;
    }
    async provide(ctx) {
        const prefs = await this.getter(ctx.sessionId);
        const entries = Object.entries(prefs);
        if (entries.length === 0) {
            return '';
        }
        const lines = ['**User preferences:**'];
        for (const [key, value] of entries) {
            lines.push(`- ${key}: ${value}`);
        }
        return this.truncateToTokens(lines.join('\n'), this.maxTokens);
    }
}
//# sourceMappingURL=user-preferences-provider.js.map