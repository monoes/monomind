/**
 * S3: org configs committed to this (public) repo must not publish the
 * owner's machine layout. Roles reference {{org_root}} / {{home}} instead of
 * absolute home paths; the runtime expands them when it builds the role
 * prompt (packages/@monomind/cli/src/orgrt/prompt-vars.ts).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Tracked org config files only: an untracked local org may name any path. */
const trackedOrgConfigs = (): string[] =>
  execFileSync('git', ['ls-files', '-z', '--', '.monomind/orgs/*.json', 'config/orgs/*.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);

const HOME_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+/g;

describe('tracked org configs', () => {
  const files = trackedOrgConfigs();

  it('are found', () => {
    expect(files).toContain('.monomind/orgs/monomind-dev.json');
  });

  it('contain no absolute home paths', () => {
    const offenders = files.flatMap((f) =>
      (readFileSync(join(repoRoot, f), 'utf8').match(HOME_PATH) ?? []).map((m) => `${f}: ${m}`),
    );
    expect(offenders).toEqual([]);
  });
});

/** Names used as obvious placeholders in fixtures and docs. Anything else
 *  under /home or /Users in a tracked file is someone's real machine layout. */
const PLACEHOLDER_USERS = new Set([
  'alice',
  'bob',
  'carol',
  'foo',
  'user',
  'u',
  'owner',
  'someone',
  'ci',
  'monomind',
  'runner',
  'me',
  'you',
  'example',
]);

describe('every tracked file', () => {
  it('names no real home directory', () => {
    // git grep, not a file walk: it reads exactly what is committed-to-be.
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-IonE', '/(home|Users)/[A-Za-z0-9._-]+/'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      if ((err as { status?: number }).status !== 1) throw err; // 1 = no matches
    }
    const offenders = out
      .split('\n')
      .filter(Boolean)
      .filter((line) => {
        const user = /\/(?:home|Users)\/([A-Za-z0-9._-]+)\/$/.exec(line)?.[1];
        return user !== undefined && !PLACEHOLDER_USERS.has(user);
      });
    expect(offenders).toEqual([]);
  });
});
