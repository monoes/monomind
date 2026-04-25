/**
 * ProjectConventionsProvider — loads project-level conventions (e.g. from
 * CLAUDE.md or a config file) and injects them as a required context section.
 */

import { BaseContextProvider, type RunContext } from './context-provider.js';

export type ConventionsLoader = () => string;

export class ProjectConventionsProvider extends BaseContextProvider {
  readonly name = 'project-conventions' as const;
  readonly priority = 100;
  readonly required = true;

  constructor(private readonly loader: ConventionsLoader) {
    super();
  }

  async provide(_ctx: RunContext): Promise<string> {
    return this.loader();
  }
}
