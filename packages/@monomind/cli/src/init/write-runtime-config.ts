/**
 * Runtime configuration writers: .monomind/config.yaml, initial metrics files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, MAX_EXEC_FILE_BYTES } from './shared.js';
import type { InitOptions, InitResult } from './types.js';
import { writeCapabilitiesDoc } from './write-capabilities.js';

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

  atomicWriteFile(configPath, config);
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
`;

  if (!fs.existsSync(gitignorePath) || options.force) {
    atomicWriteFile(gitignorePath, gitignore);
    result.created.files.push('.monomind/.gitignore');
  }

  // Ensure the project-level .gitignore does NOT blanket-ignore .monomind/
  // A blanket ignore prevents config, metrics, and knowledge graph from being committed.
  // We remove any bare `.monomind/` or `**/.monomind/` lines and add specific excludes instead.
  const projectGitignorePath = path.join(targetDir, '.gitignore');
  if (
    fs.existsSync(projectGitignorePath) &&
    fs.statSync(projectGitignorePath).size <= MAX_EXEC_FILE_BYTES
  ) {
    const existing = fs.readFileSync(projectGitignorePath, 'utf-8');
    const blanketPattern = /^(\*\*\/)?\.monomind\/?\s*$/gm;
    if (blanketPattern.test(existing)) {
      const fixed = existing
        .split('\n')
        .filter((line) => !/^(\*\*\/)?\.monomind\/?\s*$/.test(line))
        .join('\n');
      const specificExcludes = [
        '# monomind runtime — exclude sensitive and machine-specific data',
        '.monomind/sessions/',
        '.monomind/security/',
        '.monomind/*.tmp',
        '.monomind/*.log',
        '.monomind/daemon.pid',
        '.monomind/*.db',
        '.monomind/*.db-wal',
        '.monomind/*.db-shm',
      ].join('\n');
      atomicWriteFile(projectGitignorePath, `${fixed.trimEnd()}\n${specificExcludes}\n`);
      result.updated.push('.gitignore (replaced blanket .monomind/ ignore with specific excludes)');
    }
  }

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
