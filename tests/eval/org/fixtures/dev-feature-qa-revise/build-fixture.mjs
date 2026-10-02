// Builds the dev-feature-qa fixture repository from ./template, reproducibly:
// the same files, author, dates and message always give the same commit hash,
// so a trial can pin it. Usage: node build-fixture.mjs <empty output dir>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) throw new Error('usage: node build-fixture.mjs <empty output dir>');
if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`);

cpSync(join(dirname(fileURLToPath(import.meta.url)), 'template'), out, { recursive: true });
const env = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'nokhodian',
  GIT_AUTHOR_EMAIL: 'nokhodian@gmail.com',
  GIT_COMMITTER_NAME: 'nokhodian',
  GIT_COMMITTER_EMAIL: 'nokhodian@gmail.com',
  GIT_AUTHOR_DATE: '2026-10-02T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-02T00:00:00Z',
};
const git = (...args) => execFileSync('git', args, { cwd: out, env, encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'dev-feature-qa-revise fixture: duration parser with a seeded defect');
console.log(git('rev-parse', 'HEAD'));
