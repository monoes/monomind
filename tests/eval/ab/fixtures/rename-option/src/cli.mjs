import { loadConfig } from './config.mjs';

// `--retries N` on the command line sets the retry option.
export function parseArgs(argv) {
  const i = argv.indexOf('--retries');
  return i === -1 ? loadConfig() : loadConfig({ retries: Number(argv[i + 1]) });
}
