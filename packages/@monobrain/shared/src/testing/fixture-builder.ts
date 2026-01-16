import { TestModel } from './test-model.js';

export class FixtureBuilder {
  private fixtures: Array<{ prompt: string; response: string }> = [];

  addFixture(prompt: string, response: string): this {
    this.fixtures.push({ prompt, response });
    return this;
  }

  addFromFile(path: string): this {
    // Placeholder: would read fixtures from a JSON file
    return this;
  }

  build(): TestModel {
    const model = new TestModel();
    for (const { prompt, response } of this.fixtures) {
      model.addFixture(prompt, response);
    }
    return model;
  }
}

export class AgentTestBench {
  constructor(private model: TestModel) {}

  async runPrompt(prompt: string): Promise<string> {
    return this.model.generate(prompt);
  }

  async runBatch(prompts: string[]): Promise<string[]> {
    return Promise.all(prompts.map(p => this.model.generate(p)));
  }
}
