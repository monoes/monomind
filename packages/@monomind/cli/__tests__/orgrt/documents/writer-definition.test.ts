// packages/@monomind/cli/__tests__/orgrt/documents/writer-definition.test.ts
// P4.4: the single-writer findings of a definition, through the checklist every save and start path runs
// (validate-checklist.ts -> definition.ts -> definition-writes.ts -> the P4.2 core). Literal definitions only.
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { checklistFindings } from '../../../src/orgrt/validate-checklist.js';
import { sectionsRaw } from '../support/sections-defs.js';

type Raw = Record<string, any>;
const check = (patch: (raw: Raw) => void) => checklistFindings(OrgDefSchema.parse(sectionsRaw(patch)));
const role = (raw: Raw, id: string) => raw.roles.find((r: Raw) => r.id === id);
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
/** The writer is `researcher`; the lead of its section can neither write files nor run a shell. */
const oneWriter = (raw: Raw) => {
  raw.sections.research.writes = ['src/**'];
  role(raw, 'research-lead').policy = { denyTools: [...NO_FILE_TOOLS, 'Bash'] };
};
const sectionErrors = (f: { errors: string[] }) => f.errors;

describe('writer definition findings (P4.4)', () => {
  it('a Phase 3 definition with one writing section and read-only others passes', () => {
    const f = check(oneWriter);
    expect(f.errors).toEqual([]);
  });

  it('a section that declares no writes, or an empty list, gets exactly the findings it got before', () => {
    const base = check(() => {});
    expect(check((r) => (r.sections.research.writes = []))).toEqual(base);
    expect(check((r) => (r.sections.research.writes = [])).errors).toEqual([]);
  });

  it('two roles that can change the workspace are refused, naming both and the remedy', () => {
    const f = check((r) => (r.sections.research.writes = ['src/**']));
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toMatch(/^workspace repo: 2 roles can change it, at most one may — research-lead \(/);
    expect(f.errors[0]).toContain('researcher (');
    expect(f.errors[0]).toContain('make the others read-only');
  });

  it('a second writing section is refused with the text definition.ts always had, once', () => {
    const f = check((r) => {
      r.sections.research.writes = ['src/a'];
      r.sections.development.writes = ['src/b'];
    });
    expect(sectionErrors(f)).toEqual([
      'sections.research, sections.development: only one section may declare writes in this build (a single writer per repository, merge_owner is not yet supported) — keep writes on one section and hand the rest off as documents',
    ]);
  });

  it('worktree-per-role together with writes is refused (a build choice: separate trees mean separate writers)', () => {
    const f = check((r) => {
      oneWriter(r);
      r.run_config.workspace = 'worktree-per-role';
    });
    expect(f.errors).toEqual([
      'run_config.workspace: "worktree-per-role" cannot be combined with sections.<s>.writes — separate trees mean separate writers (not yet supported), and a failed worktree silently shares the project directory; use "repo", "isolated" or a path',
    ]);
  });

  it('a read-only role with its own write grant is an error, not silently narrowed', () => {
    const f = check((r) => {
      oneWriter(r);
      role(r, 'coder').policy = { fileWrite: ['src/**'] };
    });
    expect(f.errors).toEqual([
      expect.stringContaining('roles.coder.policy.fileWrite: src/** would let a read-only role change the shared workspace'),
    ]);
  });

  it('git above read on a role that must be read-only is an error', () => {
    const f = check((r) => {
      oneWriter(r);
      role(r, 'dev-lead').policy = { git: 'commit' };
    });
    expect(f.errors).toEqual([expect.stringContaining('roles.dev-lead.policy.git: "commit" lets a read-only role change the repository')]);
  });

  it('a writer whose own fileWrite is not covered by writes is an error naming the entry', () => {
    const f = check((r) => {
      oneWriter(r);
      role(r, 'researcher').policy = { fileWrite: ['src/a/**', 'lib/**'] };
    });
    expect(f.errors).toEqual([expect.stringContaining('roles.researcher.policy.fileWrite: lib/** not covered by the section\'s writes (src/**)')]);
  });

  it('writes that nobody can use is a warning, not an error', () => {
    const f = check((r) => {
      r.sections.research.writes = ['src/**'];
      for (const id of ['research-lead', 'researcher']) role(r, id).policy = { denyTools: [...NO_FILE_TOOLS, 'Bash'] };
    });
    expect(f.errors).toEqual([]);
    expect(f.warnings).toContainEqual(expect.stringContaining('sections.research.writes: no role can write the workspace'));
  });

  it('a read-only role whose sandbox mode is "off" gets a warning that the overlay replaces it', () => {
    const f = check(oneWriter);
    expect(f.warnings).toContain(
      'roles.coder.policy.sandbox.mode: "off" is replaced by "required" for a read-only role — set "required" or remove it',
    );
  });

  it('a role on another runner counts as a writer (its effects cannot be classified)', () => {
    const f = check((r) => {
      oneWriter(r);
      role(r, 'coder').runtime = 'codex';
    });
    expect(f.errors).toEqual([expect.stringContaining('coder (the "codex" runner')]);
  });
});
