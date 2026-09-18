/**
 * Runtime configuration writers: .monomind/config.yaml, initial metrics files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, MAX_EXEC_FILE_BYTES, writeGeneratedFile } from './shared.js';
import type { InitOptions, InitResult } from './types.js';
import { writeCapabilitiesDoc } from './write-capabilities.js';

/**
 * Replacement list for a project-root `.gitignore`'s blanket `.monomind/`
 * line — see the `replacementIsBlanketEquivalent` guard below. Exported
 * (not just a local const) so its "contains no blanket-shaped entry" claim
 * is a directly testable invariant rather than only a comment (i-066
 * reviewer, "Plus one addition").
 */
export const MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES = [
  '# monomind runtime — exclude sensitive and machine-specific data',
  '.monomind/sessions/',
  '.monomind/security/',
  '.monomind/*.tmp',
  '.monomind/*.log',
  '.monomind/daemon.pid',
  '.monomind/*.db',
  '.monomind/*.db-wal',
  '.monomind/*.db-shm',
  '.monomind/monoes-connection.json',
];

/** The line the generated `.monomind/.gitignore` needs to cover the
 * monoes.me refresh token — kept as one constant so the "does the existing
 * file already cover it" check and the line we'd append can never drift
 * from each other. */
const MONOES_CONNECTION_GITIGNORE_LINE = 'monoes-connection.json';

/**
 * Write runtime configuration (.monomind/)
 */
export async function writeRuntimeConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const configPath = path.join(targetDir, '.monomind', 'config.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    result.skipped.push('.monomind/config.yaml');
    return;
  }

  const config = `# Monomind Runtime Configuration
# Generated: ${new Date().toISOString()}

version: "3.0.0"

swarm:
  topology: ${options.runtime.topology}
  maxAgents: ${options.runtime.maxAgents}
  autoScale: true
  coordinationStrategy: consensus

memory:
  backend: ${options.runtime.memoryBackend}
  persistPath: .monomind/data
  cacheSize: 100
  # ADR-049: Self-Learning Memory
  learningBridge:
    enabled: ${options.runtime.enableLearningBridge ?? options.runtime.enableNeural}
    confidenceDecayRate: 0.005
    accessBoostAmount: 0.03
    consolidationThreshold: 10
  agentScopes:
    enabled: ${options.runtime.enableAgentScopes ?? true}
    defaultScope: project

neural:
  enabled: ${options.runtime.enableNeural}
  modelPath: .monomind/neural

hooks:
  enabled: true
  autoExecute: true

mcp:
  autoStart: ${options.mcp.autoStart}
  port: ${options.mcp.port}
`;

  writeGeneratedFile(configPath, config);
  result.created.files.push('.monomind/config.yaml');

  // Write .monomind/.gitignore — commit config/knowledge/metrics, exclude sensitive data
  const gitignorePath = path.join(targetDir, '.monomind', '.gitignore');
  const gitignore = `# Monomind — exclude files that may contain secrets or sensitive prompt data
# Sessions contain conversation history (prompts, code snippets, user data)
sessions/
# Security scan results may expose vulnerability details
security/
# Temporary and machine-specific files
*.tmp
*.log
daemon.pid
# Never commit credentials or keys
*.key
*.token
*.secret
.env
# monoes.me OAuth refresh token (i-066) — must never be committed
monoes-connection.json
`;

  if (!fs.existsSync(gitignorePath) || options.force) {
    atomicWriteFile(gitignorePath, gitignore);
    result.created.files.push('.monomind/.gitignore');
  } else {
    // i-066 reviewer finding 3: a project inited BEFORE this fix — every
    // project that could hold a monoes.me token, since you have to have
    // connected to have one — keeps its old .monomind/.gitignore forever
    // unless --force is passed, and none of that file's original patterns
    // (*.key, *.token, *.secret, .env) match a file literally named
    // monoes-connection.json. Make the fix additive: append the missing
    // coverage line even on a non-forced re-init, content-guarded so a
    // second run is a no-op.
    const existingGitignore = fs.readFileSync(gitignorePath, 'utf-8');
    const alreadyCovered = existingGitignore
      .split('\n')
      .some((line) => line.trim() === MONOES_CONNECTION_GITIGNORE_LINE);
    if (!alreadyCovered) {
      atomicWriteFile(
        gitignorePath,
        `${existingGitignore.trimEnd()}\n# monoes.me OAuth refresh token (i-066) — must never be committed\n${MONOES_CONNECTION_GITIGNORE_LINE}\n`,
      );
      result.updated.push('.monomind/.gitignore (added monoes-connection.json coverage)');
    }
  }

  // Ensure the project-level .gitignore does NOT blanket-ignore .monomind/
  // A blanket ignore prevents config, metrics, and knowledge graph from being committed.
  // We remove any bare `.monomind/` or `**/.monomind/` lines and add specific excludes instead —
  // i-066: but ONLY when the replacement is a strict superset of what the
  // blanket line already covered. A blanket `.monomind/` ignores every
  // current and future path under the directory; a finite specific list can
  // never be a superset of that (unless it also contains a blanket-shaped
  // entry itself), so with today's list this never fires — the user's
  // existing blanket coverage is left alone rather than narrowed. This was
  // the actual regression: the old unconditional strip could uncover
  // .monomind/monoes-connection.json (the monoes.me refresh token) for any
  // user who had sensibly blanket-ignored .monomind/.
  const projectGitignorePath = path.join(targetDir, '.gitignore');
  if (
    fs.existsSync(projectGitignorePath) &&
    fs.statSync(projectGitignorePath).size <= MAX_EXEC_FILE_BYTES
  ) {
    const existing = fs.readFileSync(projectGitignorePath, 'utf-8');
    const blanketPattern = /^(\*\*\/)?\.monomind\/?\s*$/gm;
    const specificExcludes = MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES;
    const replacementIsBlanketEquivalent = specificExcludes.some((line) =>
      /^\.monomind\/\*{1,2}\/?$/.test(line.trim()),
    );
    if (blanketPattern.test(existing) && replacementIsBlanketEquivalent) {
      const fixed = existing
        .split('\n')
        .filter((line) => !/^(\*\*\/)?\.monomind\/?\s*$/.test(line))
        .join('\n');
      atomicWriteFile(projectGitignorePath, `${fixed.trimEnd()}\n${specificExcludes.join('\n')}\n`);
      result.updated.push('.gitignore (replaced blanket .monomind/ ignore with specific excludes)');
    }
  }

  // i-066 §3.5 leak warning: moved to write-claude.ts's writeMCPConfig()
  // (reviewer finding U5 [BLOCKER]). executor.ts calls writeMCPConfig()
  // BEFORE this function, and that call can migrate/overwrite a pre-fix
  // leaked .mcp.json under --force — checking here, after that write, would
  // always inspect the already-migrated file and never warn. Checking it
  // there instead, ahead of that write, is what makes the warning actually
  // fire for the population it exists for.

  // Write CAPABILITIES.md with full system overview
  await writeCapabilitiesDoc(targetDir, options, result);
}

/**
 * Write initial metrics files for statusline
 * Creates baseline data so statusline shows meaningful state instead of all zeros
 */
export async function writeInitialMetrics(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const metricsDir = path.join(targetDir, '.monomind', 'metrics');
  const learningDir = path.join(targetDir, '.monomind', 'learning');
  const securityDir = path.join(targetDir, '.monomind', 'security');

  // Ensure directories exist
  for (const dir of [metricsDir, learningDir, securityDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create initial v1-progress.json
  const progressPath = path.join(metricsDir, 'v1-progress.json');
  if (!fs.existsSync(progressPath) || options.force) {
    const progress = {
      version: '3.0.0',
      initialized: new Date().toISOString(),
      domains: {
        completed: 0,
        total: 5,
        status: 'INITIALIZING',
      },
      ddd: {
        progress: 0,
        modules: 0,
        totalFiles: 0,
        totalLines: 0,
      },
      swarm: {
        activeAgents: 0,
        maxAgents: options.runtime.maxAgents,
        topology: options.runtime.topology,
      },
      learning: {
        status: 'READY',
        patternsLearned: 0,
        sessionsCompleted: 0,
      },
      _note: 'Metrics will update as you use Monomind (workers refresh at session start).',
    };
    atomicWriteFile(progressPath, JSON.stringify(progress, null, 2));
    result.created.files.push('.monomind/metrics/v1-progress.json');
  }

  // Create initial monoswarm-activity.json
  const activityPath = path.join(metricsDir, 'monoswarm-activity.json');
  if (!fs.existsSync(activityPath) || options.force) {
    const activity = {
      timestamp: new Date().toISOString(),
      processes: {
        mcp_server: 0,
        estimated_agents: 0,
      },
      monoswarm: {
        active: false,
        agent_count: 0,
        coordination_active: false,
      },
      integration: {
        mcp_active: false,
      },
      _initialized: true,
    };
    atomicWriteFile(activityPath, JSON.stringify(activity, null, 2));
    result.created.files.push('.monomind/metrics/monoswarm-activity.json');
  }

  // Create initial learning.json
  const learningPath = path.join(metricsDir, 'learning.json');
  if (!fs.existsSync(learningPath) || options.force) {
    const learning = {
      initialized: new Date().toISOString(),
      routing: {
        accuracy: 0,
        decisions: 0,
      },
      patterns: {
        shortTerm: 0,
        longTerm: 0,
        quality: 0,
      },
      sessions: {
        total: 0,
        current: null,
      },
      _note: 'Intelligence grows as you use Monomind',
    };
    atomicWriteFile(learningPath, JSON.stringify(learning, null, 2));
    result.created.files.push('.monomind/metrics/learning.json');
  }

  // Create initial audit-status.json
  const auditPath = path.join(securityDir, 'audit-status.json');
  if (!fs.existsSync(auditPath) || options.force) {
    const audit = {
      initialized: new Date().toISOString(),
      status: 'PENDING',
      cvesFixed: 0,
      totalCves: 3,
      lastScan: null,
      _note: 'Run: npx monomind@latest security scan',
    };
    atomicWriteFile(auditPath, JSON.stringify(audit, null, 2));
    result.created.files.push('.monomind/security/audit-status.json');
  }
}
