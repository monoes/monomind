// A minimal kit used only by lib.test.ts to exercise prepare and check without a model.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const id = '_selftest';

export async function buildInputs({ dir }) {
  mkdirSync(join(dir, 'workspace'), { recursive: true });
  writeFileSync(join(dir, 'workspace', 'seed.txt'), 'seed\n');
}

export async function baseDef() {
  return {
    def: {
      name: 'x',
      goal: 'g',
      schedule: '0 * * * *',
      run_config: { workspace: '/somewhere/else' },
      roles: [
        {
          id: 'boss',
          title: 'Boss',
          type: 'boss',
          reports_to: null,
          adapter_config: { model: 'old' },
          runtime: 'codex',
        },
        { id: 'worker', title: 'Worker', type: 'specialist', reports_to: 'boss' },
      ],
    },
    task: 'Write answer.txt',
    caps: { boss: 2, worker: 4 },
    allocationUsd: 8,
    sessionCap: { tokens: 50_000 },
    deadlineSeconds: 600,
  };
}

export async function check({ workspace }) {
  let text = '';
  try {
    text = readFileSync(join(workspace, 'answer.txt'), 'utf8');
  } catch {
    /* absent */
  }
  return [{ unit: 'answer', accepted: text.trim() === '42', evidence: { text } }];
}
