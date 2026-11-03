/**
 * GH #422: the mastermind "Paperclip" admin skills misled.
 * - mastermind-approval-detail read `.monomind/orgs/<org>-approvals.json`; the real
 *   queue is `.monomind/orgs/<org>/approvals.json`, served by `monomind org
 *   approvals|approve|deny`. The skill now drives that CLI.
 * - secrets / environments / plugin-manager / invites / invite-landing /
 *   join-queue / access write side files no runtime code reads. Each now says so
 *   up front (frontmatter description and body) and claims no runtime effect.
 * - Most "invoked by `mastermind:X`" lines named slash commands that do not
 *   exist. Every remaining one must resolve to `.claude/commands/mastermind/X.md`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_DIR = join(REPO_ROOT, '.claude/skills');
const COMMANDS_DIR = join(REPO_ROOT, '.claude/commands/mastermind');
const read = (skill: string): string => readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');

const DISCLAIMER = 'bookkeeping only — not enforced by the Org Runtime';

function frontmatterDescription(md: string): string {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  const line = fm?.[1].split('\n').find((l) => l.startsWith('description:'));
  return (line ?? '').replace(/^description:\s*/, '');
}

/** The body text before the first `## ` section — what a model reads first. */
function bodyIntro(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  return body.split(/\n## /)[0];
}

describe('mastermind-approval-detail', () => {
  const md = read('mastermind-approval-detail');

  it('no longer reads the nonexistent <org>-approvals.json side file', () => {
    expect(md).not.toMatch(/-approvals\.json/);
    expect(md).not.toMatch(/-approval-comments\.jsonl/);
  });

  it('drives the real approvals CLI', () => {
    for (const cmd of ['monomind org approvals', 'monomind org approve', 'monomind org deny']) {
      expect(md).toContain(cmd);
    }
  });
});

describe.each([
  'mastermind-secrets',
  'mastermind-environments',
  'mastermind-plugin-manager',
  'mastermind-invites',
  'mastermind-invite-landing',
  'mastermind-join-queue',
  'mastermind-access',
])('%s (unbacked by the runtime)', (skill) => {
  const md = read(skill);
  const description = frontmatterDescription(md);

  it('says it is bookkeeping only in the frontmatter description', () => {
    expect(description.toLowerCase()).toContain(DISCLAIMER.toLowerCase());
    expect(description.length).toBeLessThanOrEqual(260);
  });

  it('has "not enforced" within the first 60 characters of the description', () => {
    expect(description.replace(/^"/, '').slice(0, 60)).toContain('not enforced');
  });

  it('prints a one-line ledger warning on first use', () => {
    expect(bodyIntro(md)).toContain(`WARNING: ${skill} is a ledger only`);
  });

  it('says it is bookkeeping only at the top of the body', () => {
    expect(bodyIntro(md).toLowerCase()).toContain(DISCLAIMER.toLowerCase());
  });

  it('claims no runtime effect', () => {
    expect(md).not.toMatch(/consumed by agents/i);
    expect(md).not.toMatch(/controls (where|who)/i);
    expect(md).not.toMatch(/will not load on next startup/i);
    expect(md).not.toMatch(/so the agent can run/i);
  });
});

describe('"invoked by `mastermind:X`" lines', () => {
  const skills = readdirSync(SKILLS_DIR).filter((d) => existsSync(join(SKILLS_DIR, d, 'SKILL.md')));

  it('scans the skill tree', () => {
    expect(skills.length).toBeGreaterThan(20);
  });

  it.each(skills)('%s names only slash commands that exist', (skill) => {
    const md = read(skill);
    for (const m of md.matchAll(/invoked by `mastermind:([\w-]+)`/g)) {
      expect(existsSync(join(COMMANDS_DIR, `${m[1]}.md`)), `mastermind:${m[1]}`).toBe(true);
    }
  });
});
