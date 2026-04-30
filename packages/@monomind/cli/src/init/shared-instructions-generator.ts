/**
 * Shared Instructions Generator
 *
 * Auto-detects project profile and generates:
 * 1. .agents/shared_instructions.md  — prepended to every agent prompt
 * 2. Memory seeds — pre-loaded into AgentDB so agents start with project best practices
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type { InitResult } from './types.js';

// ── Project Profile ───────────────────────────────────────────────────────────

export interface ProjectProfile {
  name: string;
  description: string;
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'unknown';
  framework: string[];          // e.g. ['react', 'nextjs']
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'cargo' | 'poetry' | 'uv' | 'pip' | 'unknown';
  testFramework: string[];      // e.g. ['vitest', 'jest']
  buildTool: string[];          // e.g. ['vite', 'tsc', 'esbuild']
  isMonorepo: boolean;
  monorepoTool: string;         // 'pnpm-workspaces' | 'turborepo' | 'nx' | ''
  database: string[];           // e.g. ['postgres', 'sqlite']
  hasDocker: boolean;
  hasCi: boolean;
  ciTool: string;               // 'github-actions' | 'circleci' | 'gitlab-ci' | ''
  maxFileLines: number | null;  // from CLAUDE.md if present
  srcDir: string;               // 'src' | 'packages' | 'lib' | 'app' | ''
  testDir: string;              // 'tests' | 'test' | '__tests__' | 'spec' | ''
  version: string;
  isPublicNpm: boolean;
}

function readJSON(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function fileExists(cwd: string, ...parts: string[]): boolean {
  return fs.existsSync(path.join(cwd, ...parts));
}

function detectSrcDir(cwd: string): string {
  for (const d of ['src', 'packages', 'lib', 'app']) {
    if (fs.existsSync(path.join(cwd, d)) && fs.statSync(path.join(cwd, d)).isDirectory()) {
      return d;
    }
  }
  return '';
}

function detectTestDir(cwd: string): string {
  for (const d of ['tests', 'test', '__tests__', 'spec']) {
    if (fs.existsSync(path.join(cwd, d)) && fs.statSync(path.join(cwd, d)).isDirectory()) {
      return d;
    }
  }
  return '';
}

function extractMaxFileLines(claudeMd: string): number | null {
  const m = claudeMd.match(/(?:keep|max|under|limit).*?(\d{3,4})\s*lines/i);
  return m ? parseInt(m[1], 10) : null;
}

export function detectProjectProfile(cwd: string): ProjectProfile {
  const profile: ProjectProfile = {
    name: path.basename(cwd),
    description: '',
    language: 'unknown',
    framework: [],
    packageManager: 'unknown',
    testFramework: [],
    buildTool: [],
    isMonorepo: false,
    monorepoTool: '',
    database: [],
    hasDocker: false,
    hasCi: false,
    ciTool: '',
    maxFileLines: null,
    srcDir: detectSrcDir(cwd),
    testDir: detectTestDir(cwd),
    version: '0.0.0',
    isPublicNpm: false,
  };

  // ── package.json (Node/TS/JS) ──────────────────────────────────────────────
  const pkg = readJSON(path.join(cwd, 'package.json'));
  if (pkg) {
    profile.name = (pkg['name'] as string) || profile.name;
    profile.description = (pkg['description'] as string) || '';
    profile.version = (pkg['version'] as string) || '0.0.0';
    profile.isPublicNpm = !(pkg['private'] as boolean);

    const deps = {
      ...(pkg['dependencies'] as Record<string, string> || {}),
      ...(pkg['devDependencies'] as Record<string, string> || {}),
      ...(pkg['peerDependencies'] as Record<string, string> || {}),
    };

    // Language
    profile.language = deps['typescript'] || fileExists(cwd, 'tsconfig.json') ? 'typescript' : 'javascript';

    // Package manager
    if (fileExists(cwd, 'pnpm-lock.yaml') || fileExists(cwd, 'pnpm-workspace.yaml')) profile.packageManager = 'pnpm';
    else if (fileExists(cwd, 'yarn.lock')) profile.packageManager = 'yarn';
    else if (fileExists(cwd, 'bun.lockb')) profile.packageManager = 'bun';
    else profile.packageManager = 'npm';

    // Monorepo
    if (fileExists(cwd, 'pnpm-workspace.yaml') || (pkg['workspaces'] && profile.packageManager === 'pnpm')) {
      profile.isMonorepo = true;
      profile.monorepoTool = 'pnpm-workspaces';
    } else if (pkg['workspaces']) {
      profile.isMonorepo = true;
      profile.monorepoTool = 'npm-workspaces';
    }
    if (deps['turbo'] || fileExists(cwd, 'turbo.json')) {
      profile.isMonorepo = true;
      profile.monorepoTool = 'turborepo';
    }
    if (deps['nx'] || fileExists(cwd, 'nx.json')) {
      profile.isMonorepo = true;
      profile.monorepoTool = 'nx';
    }

    // Framework
    if (deps['next']) profile.framework.push('nextjs');
    else if (deps['react']) profile.framework.push('react');
    if (deps['vue']) profile.framework.push('vue');
    if (deps['nuxt'] || deps['nuxt3']) profile.framework.push('nuxt');
    if (deps['@angular/core']) profile.framework.push('angular');
    if (deps['svelte'] || deps['@sveltejs/kit']) profile.framework.push('svelte');
    if (deps['express']) profile.framework.push('express');
    if (deps['fastify']) profile.framework.push('fastify');
    if (deps['hono']) profile.framework.push('hono');
    if (deps['@nestjs/core']) profile.framework.push('nestjs');
    if (deps['elysia']) profile.framework.push('elysia');

    // Testing
    if (deps['vitest']) profile.testFramework.push('vitest');
    if (deps['jest'] || deps['@jest/core']) profile.testFramework.push('jest');
    if (deps['mocha']) profile.testFramework.push('mocha');
    if (deps['@playwright/test']) profile.testFramework.push('playwright');
    if (deps['cypress']) profile.testFramework.push('cypress');

    // Build
    if (deps['vite'] || fileExists(cwd, 'vite.config.ts') || fileExists(cwd, 'vite.config.js')) profile.buildTool.push('vite');
    if (deps['esbuild']) profile.buildTool.push('esbuild');
    if (deps['webpack']) profile.buildTool.push('webpack');
    if (deps['rollup']) profile.buildTool.push('rollup');
    if (fileExists(cwd, 'tsconfig.json') && profile.buildTool.length === 0) profile.buildTool.push('tsc');

    // Database
    if (deps['pg'] || deps['postgres'] || deps['@neondatabase/serverless']) profile.database.push('postgres');
    if (deps['better-sqlite3'] || deps['@libsql/client'] || deps['sql.js']) profile.database.push('sqlite');
    if (deps['mongoose'] || deps['mongodb']) profile.database.push('mongodb');
    if (deps['redis'] || deps['ioredis']) profile.database.push('redis');
    if (deps['drizzle-orm']) profile.database.push('drizzle');
    if (deps['prisma'] || deps['@prisma/client']) profile.database.push('prisma');
    if (deps['@supabase/supabase-js']) profile.database.push('supabase');
  }

  // ── Cargo.toml (Rust) ──────────────────────────────────────────────────────
  if (fileExists(cwd, 'Cargo.toml') && profile.language === 'unknown') {
    profile.language = 'rust';
    profile.packageManager = 'cargo';
    try {
      const cargo = fs.readFileSync(path.join(cwd, 'Cargo.toml'), 'utf-8');
      const nameM = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameM) profile.name = nameM[1];
      if (fileExists(cwd, 'Cargo.lock') && cargo.includes('[workspace]')) profile.isMonorepo = true;
      if (cargo.includes('axum') || cargo.includes('actix') || cargo.includes('warp')) profile.framework.push('web');
      if (cargo.includes('tokio')) profile.framework.push('tokio');
      if (cargo.includes('serde')) profile.framework.push('serde');
    } catch { /* skip */ }
  }

  // ── pyproject.toml / requirements.txt (Python) ────────────────────────────
  if ((fileExists(cwd, 'pyproject.toml') || fileExists(cwd, 'requirements.txt')) && profile.language === 'unknown') {
    profile.language = 'python';
    if (fileExists(cwd, 'poetry.lock')) profile.packageManager = 'poetry';
    else if (fileExists(cwd, 'uv.lock')) profile.packageManager = 'uv';
    else profile.packageManager = 'pip';
    try {
      const pp = fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf-8');
      if (pp.includes('fastapi') || pp.includes('FastAPI')) profile.framework.push('fastapi');
      if (pp.includes('django')) profile.framework.push('django');
      if (pp.includes('flask')) profile.framework.push('flask');
      if (pp.includes('pytest')) profile.testFramework.push('pytest');
      if (pp.includes('sqlalchemy')) profile.database.push('sqlalchemy');
    } catch { /* skip */ }
  }

  // ── go.mod (Go) ───────────────────────────────────────────────────────────
  if (fileExists(cwd, 'go.mod') && profile.language === 'unknown') {
    profile.language = 'go';
    profile.packageManager = 'unknown'; // go mod doesn't have a separate PM
    try {
      const gomod = fs.readFileSync(path.join(cwd, 'go.mod'), 'utf-8');
      if (gomod.includes('gin-gonic/gin')) profile.framework.push('gin');
      if (gomod.includes('labstack/echo')) profile.framework.push('echo');
      if (gomod.includes('gofiber/fiber')) profile.framework.push('fiber');
    } catch { /* skip */ }
  }

  // ── Infrastructure detection ───────────────────────────────────────────────
  profile.hasDocker = fileExists(cwd, 'Dockerfile') || fileExists(cwd, 'docker-compose.yml') || fileExists(cwd, 'docker-compose.yaml');

  if (fileExists(cwd, '.github', 'workflows')) {
    profile.hasCi = true;
    profile.ciTool = 'github-actions';
  } else if (fileExists(cwd, '.circleci')) {
    profile.hasCi = true;
    profile.ciTool = 'circleci';
  } else if (fileExists(cwd, '.gitlab-ci.yml')) {
    profile.hasCi = true;
    profile.ciTool = 'gitlab-ci';
  }

  // ── CLAUDE.md conventions extraction ──────────────────────────────────────
  try {
    const claudeMd = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8');
    profile.maxFileLines = extractMaxFileLines(claudeMd);
  } catch { /* skip */ }

  return profile;
}

// ── Shared Instructions Generator ────────────────────────────────────────────

function langBestPractices(profile: ProjectProfile): string {
  const { language, framework, testFramework, buildTool, packageManager, isMonorepo, database } = profile;

  const sections: string[] = [];

  if (language === 'typescript' || language === 'javascript') {
    sections.push(`## TypeScript / Node.js Best Practices
- Use \`const\` by default; \`let\` only when the variable must be reassigned
- Prefer \`async/await\` over raw Promises or callbacks
- Always type function parameters and return values explicitly — no implicit \`any\`
- Use \`unknown\` instead of \`any\` at system boundaries; narrow with type guards
- Keep modules small and focused — one clear responsibility per file
- Prefer named exports over default exports (easier to refactor and search)
- Use \`satisfies\` operator to validate literals against types without widening
- Handle errors explicitly — never swallow them silently`);

    if (language === 'typescript') {
      sections.push(`## TypeScript Strictness
- Always enable \`strict: true\` in tsconfig
- Use \`readonly\` for arrays and objects that shouldn't be mutated
- Prefer \`interface\` for public API shapes, \`type\` for unions/intersections/computed
- Use discriminated unions for state machines and result types`);
    }
  }

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
- Do not fetch more columns than needed — avoid \`SELECT *\`${database.includes('drizzle') ? '\n- Use Drizzle schema objects for all query building — no raw SQL except for complex aggregates' : ''}${database.includes('prisma') ? '\n- Use Prisma transactions (\`prisma.$transaction\`) for multi-step writes' : ''}`);
  }

  // Monorepo
  if (isMonorepo) {
    const pmRun = packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm run';
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
  const { name, description, language, framework, packageManager, srcDir, testDir, maxFileLines } = profile;

  const runCmd = packageManager === 'pnpm' ? 'pnpm' :
                 packageManager === 'yarn' ? 'yarn' :
                 packageManager === 'bun'  ? 'bun run' :
                 packageManager === 'cargo' ? 'cargo' :
                 packageManager === 'poetry' ? 'poetry run' :
                 packageManager === 'uv' ? 'uv run' :
                 'npm run';

  const langLabel = language === 'typescript' ? 'TypeScript' :
                    language === 'javascript' ? 'JavaScript' :
                    language === 'python' ? 'Python' :
                    language === 'rust' ? 'Rust' :
                    language === 'go' ? 'Go' : 'Unknown';

  const frameworkStr = profile.framework.length ? ` · ${profile.framework.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(' + ')}` : '';
  const dbStr = profile.database.length ? `\n- **Database:** ${profile.database.join(', ')}` : '';
  const testStr = profile.testFramework.length ? `\n- **Test framework:** ${profile.testFramework.join(', ')}` : '';
  const ciStr = profile.hasCi ? `\n- **CI:** ${profile.ciTool}` : '';
  const monorepoStr = profile.isMonorepo ? `\n- **Monorepo:** yes (${profile.monorepoTool})` : '';
  const maxLinesStr = maxFileLines ? `\n- **Max file size:** ${maxFileLines} lines` : '';

  return `# ${name} — Shared Agent Instructions

> Auto-generated by \`monomind init\`. Edit freely — this file is prepended to every agent prompt.
> Stack: **${langLabel}${frameworkStr}**

## Project Overview
${description ? `\n${description}\n` : ''}
- **Language:** ${langLabel}
- **Package manager:** ${packageManager}
- **Source directory:** ${srcDir || '(root)'}
- **Test directory:** ${testDir || '(co-located)'}${maxLinesStr}${dbStr}${testStr}${ciStr}${monorepoStr}

## How to Run
\`\`\`bash
# Install dependencies
${packageManager === 'cargo' ? 'cargo build' :
  packageManager === 'poetry' ? 'poetry install' :
  packageManager === 'uv' ? 'uv sync' :
  `${packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm'} install`}

# Run tests
${profile.testFramework.includes('vitest') ? `${runCmd} test` :
  profile.testFramework.includes('jest') ? `${runCmd} test` :
  profile.testFramework.includes('pytest') ? 'pytest' :
  language === 'rust' ? 'cargo test' :
  language === 'go' ? 'go test ./...' :
  `${runCmd} test`}

# Type check / lint
${language === 'typescript' ? `${runCmd} typecheck` :
  language === 'python' ? 'mypy . && ruff check .' :
  language === 'rust' ? 'cargo clippy' :
  language === 'go' ? 'go vet ./...' :
  `${runCmd} lint`}
\`\`\`

## Critical Constraints
- **Never** modify files outside your assigned task scope
- **Always** run tests before reporting a task complete
- **Never** commit secrets, credentials, or .env files
- **Always** write tests alongside implementation (TDD)
- Prefer editing existing files over creating new ones
- Keep commits small and descriptive (conventional commits format)
${maxFileLines ? `- Keep files under **${maxFileLines} lines** — split when approaching the limit\n` : ''}- NEVER save working files to the root directory — use ${srcDir || 'src'}/ for source, ${testDir || 'tests'}/ for tests

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
      value: 'Use Result<T, E> pattern with discriminated unions for recoverable errors. Never throw in library code. Use unknown instead of any at boundaries, narrow with type guards.',
      namespace: 'patterns',
    });
    seeds.push({
      key: 'ts-module-structure',
      value: 'One responsibility per file. Named exports only. Types in .types.ts files co-located with implementation. Index barrel files only at package boundaries, not inside modules.',
      namespace: 'patterns',
    });
  }

  if (profile.language === 'python') {
    seeds.push({
      key: 'py-error-handling',
      value: 'Use specific exception types, never bare except. Use contextlib.suppress only for truly ignorable errors. Log exceptions with traceback before re-raising or swallowing.',
      namespace: 'patterns',
    });
  }

  if (profile.language === 'rust') {
    seeds.push({
      key: 'rust-error-handling',
      value: 'Use thiserror for library errors, anyhow for application errors. Avoid unwrap() in production paths. Document safety invariants in any unsafe block.',
      namespace: 'patterns',
    });
  }

  // Framework patterns
  if (profile.framework.includes('react') || profile.framework.includes('nextjs')) {
    seeds.push({
      key: 'react-component-pattern',
      value: 'Keep components under 200 lines. Extract business logic to custom hooks. Use Server Components by default in Next.js app router. Co-locate tests with components.',
      namespace: 'patterns',
    });
  }

  if (profile.framework.includes('nestjs')) {
    seeds.push({
      key: 'nestjs-layer-pattern',
      value: 'Controller → Service → Repository layering. DTOs with class-validator for all input. Guards for auth, Interceptors for cross-cutting concerns. Never inject repositories directly into controllers.',
      namespace: 'patterns',
    });
  }

  // Database patterns
  if (profile.database.includes('postgres') || profile.database.includes('sqlite')) {
    seeds.push({
      key: 'db-query-safety',
      value: 'Always use parameterized queries. Never interpolate user input into SQL. Index foreign keys. Use transactions for multi-step writes. Prefer specific column selects over SELECT *.',
      namespace: 'patterns',
    });
  }

  if (profile.database.includes('drizzle')) {
    seeds.push({
      key: 'drizzle-patterns',
      value: 'Always use drizzle schema objects for queries. Use db.transaction() for atomic operations. Keep schema definitions in schema.ts. Run drizzle-kit generate after schema changes.',
      namespace: 'patterns',
    });
  }

  // Testing patterns
  if (profile.testFramework.includes('vitest') || profile.testFramework.includes('jest')) {
    seeds.push({
      key: 'tdd-pattern',
      value: 'Red-Green-Refactor cycle. Write the failing test first. Mock at the boundary (HTTP clients, DB adapters). Test behavior not implementation. Each test describes one behavior.',
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

export function writeSharedInstructions(
  cwd: string,
  force: boolean,
  result: InitResult,
): void {
  const agentsDir = path.join(cwd, '.agents');
  const siPath = path.join(agentsDir, 'shared_instructions.md');

  // Skip if already exists and not forcing
  if (fs.existsSync(siPath) && !force) {
    result.skipped.push('.agents/shared_instructions.md');
    return;
  }

  try {
    const profile = detectProjectProfile(cwd);
    const content = generateSharedInstructions(profile);

    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }
    fs.writeFileSync(siPath, content, 'utf-8');
    result.created.files.push('.agents/shared_instructions.md');

    // Seed memory (best-effort, non-blocking)
    const seeds = generateMemorySeeds(profile);
    for (const seed of seeds) {
      try {
        execSync(
          `npx --yes monomind@latest memory store --key "${seed.key}" --value ${JSON.stringify(seed.value)} --namespace ${seed.namespace}`,
          { cwd, stdio: 'ignore', timeout: 8000 },
        );
      } catch {
        // Non-critical — memory seeding is best-effort
      }
    }

    if (seeds.length > 0) {
      result.created.files.push(`.agents: ${seeds.length} memory patterns seeded`);
    }
  } catch {
    // Non-critical — shared instructions generation is best-effort
  }
}
