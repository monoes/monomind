/**
 * Context module — dynamic system prompt assembly.
 *
 * Re-exports all context providers and the prompt assembler.
 */

export {
  type RunContext,
  type ContextSection,
  type ContextProvider,
  BaseContextProvider,
} from './context-provider.js';

export { GitStateProvider } from './git-state-provider.js';

export {
  TaskHistoryProvider,
  type SearchFn,
  type SearchResult,
} from './task-history-provider.js';

export {
  ProjectConventionsProvider,
  type ConventionsLoader,
} from './project-conventions-provider.js';

export {
  UserPreferencesProvider,
  type PreferencesGetter,
} from './user-preferences-provider.js';

export {
  PromptAssembler,
  type AssemblyConfig,
  type AssembledPrompt,
} from './prompt-assembler.js';
