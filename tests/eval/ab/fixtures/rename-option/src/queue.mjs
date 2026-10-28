import { loadConfig } from './config.mjs';

export function createQueue(overrides) {
  const config = loadConfig(overrides);
  const jobs = [];
  return {
    add: (job) => jobs.push({ job, left: config.retries }),
    next: () => jobs.shift(),
    describe: () => `queue with ${config.retries} retries`,
  };
}
