import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type PromptHash = string;

export interface Model {
  complete(prompt: string, options?: { maxTokens?: number; model?: string }): Promise<string>;
}

export interface TestModelConfig {
  responses: Map<PromptHash, string>;
  defaultResponse?: string;
  latencyMs?: number;
}

export function hashPrompt(prompt: string): PromptHash {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export class TestModel implements Model {
  private fixtures: Map<PromptHash, string>;
  private config: TestModelConfig;

  constructor(config: TestModelConfig) {
    this.config = config;
    this.fixtures = new Map(config.responses);
  }

  async complete(prompt: string, _options?: { maxTokens?: number; model?: string }): Promise<string> {
    if (this.config.latencyMs) {
      await new Promise(r => setTimeout(r, this.config.latencyMs));
    }
    const hash = hashPrompt(prompt);
    const cached = this.fixtures.get(hash);
    if (cached !== undefined) return cached;
    if (this.config.defaultResponse !== undefined) return this.config.defaultResponse;
    throw new Error(`TestModel: No fixture for prompt hash "${hash}". First 120 chars: ${prompt.slice(0, 120)}`);
  }

  addFixture(prompt: string, response: string): void {
    this.fixtures.set(hashPrompt(prompt), response);
  }

  addFixtureByHash(hash: PromptHash, response: string): void {
    this.fixtures.set(hash, response);
  }

  get fixtureCount(): number {
    return this.fixtures.size;
  }

  saveToFile(filePath: string): void {
    const obj: Record<string, string> = {};
    for (const [hash, response] of this.fixtures) {
      obj[hash] = response;
    }
    writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
  }

  static fromFixtureFile(filePath: string): TestModel {
    if (!existsSync(filePath)) throw new Error(`Fixture file not found: ${filePath}`);
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    // Support both flat format {hash: response} and nested format {fixtures: {hash: response}}
    const entries = raw.fixtures ? Object.entries(raw.fixtures) : Object.entries(raw);
    return new TestModel({ responses: new Map(entries as [string, string][]) });
  }

  static withDefaultResponse(response: string): TestModel {
    return new TestModel({ responses: new Map(), defaultResponse: response });
  }
}
