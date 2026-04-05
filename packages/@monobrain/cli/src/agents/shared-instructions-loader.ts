import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_PATH = '.agents/shared_instructions.md';

export class SharedInstructionsLoader {
  private cache: string | null = null;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH;
  }

  load(basePath?: string): string {
    const fullPath = basePath ? resolve(basePath, this.filePath) : this.filePath;
    if (!existsSync(fullPath)) {
      this.cache = '';
      return '';
    }
    this.cache = readFileSync(fullPath, 'utf-8');
    return this.cache;
  }

  getSharedInstructions(basePath?: string): string {
    if (this.cache !== null) return this.cache;
    return this.load(basePath);
  }

  reload(basePath?: string): string {
    this.cache = null;
    return this.load(basePath);
  }

  isLoaded(): boolean {
    return this.cache !== null;
  }

  /** Prepend shared instructions to an agent prompt with separator */
  prependToPrompt(agentPrompt: string, basePath?: string): string {
    const shared = this.getSharedInstructions(basePath);
    if (!shared) return agentPrompt;
    return `${shared}\n\n---\n\n${agentPrompt}`;
  }
}

export const sharedInstructionsLoader = new SharedInstructionsLoader();
