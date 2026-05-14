/**
 * UserPreferencesProvider — fetches user-level preferences for the active
 * session and formats them as a bullet list for injection into the prompt.
 */
import { BaseContextProvider, type RunContext } from './context-provider.js';
export type PreferencesGetter = (sessionId: string) => Promise<Record<string, string>>;
export declare class UserPreferencesProvider extends BaseContextProvider {
    private readonly getter;
    readonly name: "user-preferences";
    readonly priority = 90;
    constructor(getter: PreferencesGetter);
    provide(ctx: RunContext): Promise<string>;
}
//# sourceMappingURL=user-preferences-provider.d.ts.map