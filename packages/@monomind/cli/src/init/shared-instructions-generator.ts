/**
 * Shared Instructions Generator
 *
 * Auto-detects project profile and generates:
 * 1. .agents/shared_instructions.md  — prepended to every agent prompt
 * 2. Memory seeds — pre-loaded into SQLite so agents start with project best practices
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { guardFor } from './file-guard.js';
import { detectProjectProfile, type ProjectProfile } from './project-profile.js';
import type { InitResult } from './types.js';

export { detectProjectProfile, type ProjectProfile };

// ── Shared Instructions Generator ────────────────────────────────────────────

function langBestPractices(profile: ProjectProfile): string {
  const { language, framework, testFramework, packageManager, isMonorepo, database } = profile;

  const sections: string[] = [];

  if (language === 'python') {
    sections.push(`## Python Best Practices
- Use type hints everywhere — run \`mypy\` or \`pyright\` in strict mode
- Prefer \`dataclasses\` or \`pydantic\` models over plain dicts for structured data
- Use \`pathlib.Path\` instead of \`os.path\`
- Prefer \`with\` statements for resource management
- Use \`logging\` module, never \`print\` in production code
- Keep functions under 50 lines; split long functions immediately`);
  }

  if (language === 'rust') {
    sections.push(`## Rust Best Practices
- Prefer \`Result<T, E>\` over panics for recoverable errors
- Use \`?\` operator for error propagation
- Document all public items with \`///\` doc comments
- Run \`clippy\` before every commit
- Avoid \`unwrap()\` in production paths — use \`expect("reason")\` or proper handling
- Keep \`unsafe\` blocks minimal and always document the invariant they maintain`);
  }

  if (language === 'go') {
    sections.push(`## Go Best Practices
- Errors are values — always handle them, never \`_\` a returned error in production
- Use \`context.Context\` as the first parameter of any function that does I/O
- Prefer table-driven tests with \`t.Run\`
- Keep interfaces small — prefer 1-3 methods
- Use \`defer\` for cleanup but be aware of loop-defer pitfalls`);
  }

  // Framework-specific
  if (framework.includes('react') || framework.includes('nextjs')) {
    sections.push(`## React / Next.js Best Practices
- Prefer Server Components by default in Next.js 13+ App Router
- Co-locate tests with the component they test
- Extract shared logic into custom hooks
- Use \`useCallback\` and \`useMemo\` only when profiling shows a real problem
- Keep components under 200 lines — split into sub-components when larger
- Never put business logic in components — keep it in hooks or server actions`);
  }

  if (framework.includes('nestjs')) {
    sections.push(`## NestJS Best Practices
- Follow the module → service → controller layering strictly
- Use DTOs with class-validator for all input validation
- Inject dependencies via constructor — never instantiate services directly
- Use pipes for transformation, guards for authorization, interceptors for cross-cutting concerns`);
  }

  if (framework.includes('fastapi')) {
    sections.push(`## FastAPI Best Practices
- Use Pydantic v2 models for all request/response schemas
- Separate router, service, and repository layers
- Use \`async def\` for all endpoints that do any I/O
- Handle errors with \`HTTPException\` — never let raw exceptions propagate`);
  }

  // Testing
  if (testFramework.includes('vitest') || testFramework.includes('jest')) {
    sections.push(`## Testing (${testFramework.join(' / ')})
- Follow London School TDD: write the failing test first, then the minimum implementation
- Mock at the boundary — mock HTTP clients and DB adapters, not business logic
- Test behavior, not implementation — avoid testing private methods
- Use \`describe\` / \`it\` blocks that read like documentation
- Keep each test file focused on one unit; integration tests live in a separate directory`);
  }

  if (testFramework.includes('pytest')) {
    sections.push(`## Testing (pytest)
- Write tests before implementation (TDD)
- Use \`pytest.fixture\` for shared setup; prefer function-scoped fixtures
- Use \`pytest.mark.parametrize\` for data-driven tests
- Mock external calls with \`pytest-mock\` — never let tests hit the real network or DB`);
  }

  // Database
  if (database.includes('postgres') || database.includes('sqlite')) {
    sections.push(`## Database Best Practices
- Never run raw interpolated SQL — always use parameterized queries
- Keep migrations small and reversible
- Index foreign keys and columns used in WHERE/ORDER BY
- Use transactions for operations that must be atomic
- Do not fetch more columns than needed — avoid \`SELECT *\`${database.includes('drizzle') ? '\n- Use Drizzle schema objects for all query building — no raw SQL except for complex aggregates' : ''}${database.includes('prisma') ? '\n- Use Prisma transactions (`prisma.$transaction`) for multi-step writes' : ''}`);
  }

  // Monorepo
  if (isMonorepo) {
    const pmRun =
      packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm run';
    sections.push(`## Monorepo Conventions
- Make changes in the appropriate package — never write code that cuts across package boundaries without a clear interface
- Shared types live in a dedicated \`@<scope>/types\` or \`@<scope>/shared\` package
- Run \`${pmRun} build\` in changed packages before running tests that depend on them
- Use internal package references (workspace protocol) — never copy code between packages`);
  }

  // CI
  if (profile.hasCi) {
    sections.push(`## CI / CD
- All code must pass CI before merging — do not bypass checks
- Keep CI builds under 10 minutes — split slow jobs if needed
- Never commit secrets or API keys — use environment variables from the CI secret store
- Write commit messages that pass the conventional commits format: \`type(scope): description\``);
  }

  return sections.join('\n\n');
}

export function generateSharedInstructions(profile: ProjectProfile): string {
  const { name, description, language, packageManager, srcDir, testDir, maxFileLines } = profile;

  const runCmd =
    packageManager === 'pnpm'
      ? 'pnpm'
      : packageManager === 'yarn'
        ? 'yarn'
        : packageManager === 'bun'
          ? 'bun run'
          : packageManager === 'cargo'
            ? 'cargo'
            : packageManager === 'poetry'
              ? 'poetry run'
              : packageManager === 'uv'
                ? 'uv run'
                : 'npm run';

  const langLabel =
    language === 'typescript'
      ? 'TypeScript'
      : language === 'javascript'
        ? 'JavaScript'
        : language === 'python'
          ? 'Python'
          : language === 'rust'
            ? 'Rust'
            : language === 'go'
              ? 'Go'
              : 'Unknown';

  const frameworkStr = profile.framework.length
    ? ` · ${profile.framework.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(' + ')}`
    : '';
  const dbStr = profile.database.length ? `\n- **Database:** ${profile.database.join(', ')}` : '';
  const testStr = profile.testFramework.length
    ? `\n- **Test framework:** ${profile.testFramework.join(', ')}`
    : '';
  const ciStr = profile.hasCi ? `\n- **CI:** ${profile.ciTool}` : '';
  const monorepoStr = profile.isMonorepo ? `\n- **Monorepo:** yes (${profile.monorepoTool})` : '';
  const maxLinesStr = maxFileLines ? `\n- **Max file size:** ${maxFileLines} lines` : '';
  // 'unknown' is technically accurate for Go (no separate package manager),
  // but reads as a detection failure to an agent — say what's actually true.
  const packageManagerLabel =
    packageManager === 'unknown' && language === 'go'
      ? 'go modules (no separate package manager)'
      : packageManager;

  return `# ${name} — Shared Agent Instructions

> Auto-generated by \`monomind init\` and loaded into context at session start. Put your own edits outside the \`monomind-block\` markers — \`init --force\` regenerates the text inside them.
> Stack: **${langLabel}${frameworkStr}**

## Project Overview
${description ? `\n${description}\n` : ''}
- **Language:** ${langLabel}
- **Package manager:** ${packageManagerLabel}
- **Source directory:** ${srcDir || '(root)'}
- **Test directory:** ${testDir || '(co-located)'}${maxLinesStr}${dbStr}${testStr}${ciStr}${monorepoStr}

## How to Run
\`\`\`bash
# Install dependencies
${
  language === 'go'
    ? 'go mod download'
    : packageManager === 'cargo'
      ? 'cargo build'
      : packageManager === 'poetry'
        ? 'poetry install'
        : packageManager === 'uv'
          ? 'uv sync'
          : `${packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm'} install`
}

# Run tests
${
  profile.testFramework.includes('vitest')
    ? `${runCmd} test`
    : profile.testFramework.includes('jest')
      ? `${runCmd} test`
      : profile.testFramework.includes('pytest')
        ? 'pytest'
        : language === 'rust'
          ? 'cargo test'
          : language === 'go'
            ? 'go test ./...'
            : `${runCmd} test`
}

# Type check / lint
${
  language === 'typescript'
    ? `${runCmd} typecheck`
    : language === 'python'
      ? 'mypy . && ruff check .'
      : language === 'rust'
        ? 'cargo clippy'
        : language === 'go'
          ? 'go vet ./...'
          : `${runCmd} lint`
}
\`\`\`

## Critical Constraints
- **Never** modify files outside your assigned task scope
- **Always** run tests before reporting a task complete
- **Always** write tests alongside implementation (TDD)
- Keep commits small and descriptive (conventional commits format)

## Code Quality Non-Negotiables
- No commented-out code in committed files
- No \`TODO\` comments without a linked issue
- All public functions/methods must have typed signatures
- Errors must be handled explicitly — never silently swallowed
- Remove debug logs before committing

${langBestPractices(profile)}

## Agent Collaboration Rules
- Write a brief ## Handoff Context block when completing a task in a chain
- Include: files changed, key decisions, what the next task needs to know
- If BLOCKED, stop immediately and report with full context — do not guess
- Search project memory before starting: \`npx monomind memory search --query "[task]"\`
- Store successful patterns after completion: \`npx monomind memory store --namespace patterns --key "[pattern]" --value "[what worked]"\`
`;
}

// ── Memory Seeds ──────────────────────────────────────────────────────────────

export interface MemorySeed {
  key: string;
  value: string;
  namespace: string;
}

export function generateMemorySeeds(profile: ProjectProfile): MemorySeed[] {
  const seeds: MemorySeed[] = [];

  // Project context seed
  seeds.push({
    key: `project-profile-${profile.name}`,
    value: JSON.stringify({
      name: profile.name,
      language: profile.language,
      framework: profile.framework,
      packageManager: profile.packageManager,
      testFramework: profile.testFramework,
      isMonorepo: profile.isMonorepo,
      database: profile.database,
      srcDir: profile.srcDir,
      testDir: profile.testDir,
    }),
    namespace: 'project',
  });

  // Stack-specific best practices
  if (profile.language === 'typescript') {
    seeds.push({
      key: 'ts-error-handling',
      value:
        'Use Result<T, E> pattern with discriminated unions for recoverable errors. Never throw in library code. Use unknown instead of any at boundaries, narrow with type guards.',
      namespace: 'patterns',
    });
    seeds.push({
      key: 'ts-module-structure',
      value:
        'One responsibility per file. Named exports only. Types in .types.ts files co-located with implementation. Index barrel files only at package boundaries, not inside modules.',
      namespace: 'patterns',
    });
  }

  if (profile.language === 'python') {
    seeds.push({
      key: 'py-error-handling',
      value:
        'Use specific exception types, never bare except. Use contextlib.suppress only for truly ignorable errors. Log exceptions with traceback before re-raising or swallowing.',
      namespace: 'patterns',
    });
  }

  if (profile.language === 'rust') {
    seeds.push({
      key: 'rust-error-handling',
      value:
        'Use thiserror for library errors, anyhow for application errors. Avoid unwrap() in production paths. Document safety invariants in any unsafe block.',
      namespace: 'patterns',
    });
  }

  // Framework patterns
  if (profile.framework.includes('react') || profile.framework.includes('nextjs')) {
    seeds.push({
      key: 'react-component-pattern',
      value:
        'Keep components under 200 lines. Extract business logic to custom hooks. Use Server Components by default in Next.js app router. Co-locate tests with components.',
      namespace: 'patterns',
    });
  }

  if (profile.framework.includes('nestjs')) {
    seeds.push({
      key: 'nestjs-layer-pattern',
      value:
        'Controller → Service → Repository layering. DTOs with class-validator for all input. Guards for auth, Interceptors for cross-cutting concerns. Never inject repositories directly into controllers.',
      namespace: 'patterns',
    });
  }

  // Database patterns
  if (profile.database.includes('postgres') || profile.database.includes('sqlite')) {
    seeds.push({
      key: 'db-query-safety',
      value:
        'Always use parameterized queries. Never interpolate user input into SQL. Index foreign keys. Use transactions for multi-step writes. Prefer specific column selects over SELECT *.',
      namespace: 'patterns',
    });
  }

  if (profile.database.includes('drizzle')) {
    seeds.push({
      key: 'drizzle-patterns',
      value:
        'Always use drizzle schema objects for queries. Use db.transaction() for atomic operations. Keep schema definitions in schema.ts. Run drizzle-kit generate after schema changes.',
      namespace: 'patterns',
    });
  }

  // Testing patterns
  if (profile.testFramework.includes('vitest') || profile.testFramework.includes('jest')) {
    seeds.push({
      key: 'tdd-pattern',
      value:
        'Red-Green-Refactor cycle. Write the failing test first. Mock at the boundary (HTTP clients, DB adapters). Test behavior not implementation. Each test describes one behavior.',
      namespace: 'patterns',
    });
  }

  // Monorepo patterns
  if (profile.isMonorepo) {
    seeds.push({
      key: 'monorepo-conventions',
      value: `Monorepo uses ${profile.monorepoTool}. Changes must stay within the relevant package. Shared types in dedicated packages. Use workspace protocol for internal deps. Build changed packages before running dependent tests.`,
      namespace: 'patterns',
    });
  }

  return seeds;
}

// ── Writer (called from executor.ts) ─────────────────────────────────────────

/** Writes .agents/shared_instructions.md and returns the memory seeds for the
 *  project it described (none when the file was left alone). */
export function writeSharedInstructions(
  cwd: string,
  force: boolean,
  result: InitResult,
): MemorySeed[] {
  const agentsDir = path.join(cwd, '.agents');
  const siPath = path.join(agentsDir, 'shared_instructions.md');
  const exists = fs.existsSync(siPath);

  // Skip if already exists and not forcing
  if (exists && !force) {
    result.skipped.push('.agents/shared_instructions.md');
    return [];
  }

  try {
    const profile = detectProjectProfile(cwd);
    const generated = generateSharedInstructions(profile);
    // Confine the generated content to a delimited block rather than
    // overwriting the whole file — this file is fully auto-generated by
    // design, but users do hand-edit it (its own header says "Edit
    // freely"), and a raw `--force` overwrite silently discarded those
    // edits. See GH #241. Applying this on the very first write too means a
    // later `--force` always refreshes just this block instead of
    // duplicating the body.
    const existingContent = exists ? fs.readFileSync(siPath, 'utf-8') : '';
    const content = guardFor(cwd, { force }, result).mergeBlock(
      siPath,
      existingContent,
      'shared-instructions',
      generated,
    );
    if (content === null) {
      result.skipped.push('.agents/shared_instructions.md (edited monomind block kept)');
      return [];
    }

    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }
    fs.writeFileSync(siPath, content, 'utf-8');
    result.created.files.push('.agents/shared_instructions.md');

    // Memory seeds are returned, not stored here: the executor stores them
    // in-process once the project database exists, and only when memory is on.
    return generateMemorySeeds(profile);
  } catch {
    // Non-critical — shared instructions generation is best-effort
    return [];
  }
}
