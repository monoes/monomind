/**
 * Generates a `capability:` block template for an agent file based on
 * its existing `name` and `description` frontmatter fields.
 *
 * Usage:
 *   npx ts-node scripts/add-capability-template.ts .claude/agents/path/to/agent.md
 *
 * Prints the YAML capability block to stdout so the user can review
 * and paste it into the frontmatter.
 *
 * @module scripts/add-capability-template
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentFrontmatter {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser (minimal)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): AgentFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  let name = '';
  let description = '';

  for (const line of yaml.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.*)/);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    }
    const descMatch = line.match(/^description:\s*(.*)/);
    if (descMatch) {
      description = descMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  }

  if (!name) return null;
  return { name, description };
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function inferExpertise(description: string): string[] {
  const words = description.toLowerCase();
  const expertise: string[] = [];

  const patterns: Array<[RegExp, string]> = [
    [/security/, 'application security'],
    [/frontend|ui|ux|css/, 'frontend development'],
    [/backend|api|server/, 'backend development'],
    [/database|sql|schema/, 'database management'],
    [/devops|ci\/cd|deploy/, 'CI/CD and deployment'],
    [/architect|design|system/, 'system design'],
    [/test|tdd|qa/, 'testing strategies'],
    [/performance|optim/, 'performance optimization'],
    [/machine learning|ml|ai/, 'machine learning'],
    [/document|docs|writ/, 'technical documentation'],
    [/git|version control/, 'version control'],
    [/monitor|observ|sre/, 'observability'],
    [/container|docker|k8s/, 'container orchestration'],
    [/cloud|aws|gcp|azure/, 'cloud infrastructure'],
    [/review|quality/, 'code quality'],
  ];

  for (const [pattern, skill] of patterns) {
    if (pattern.test(words)) {
      expertise.push(skill);
    }
  }

  // Ensure minimum 3 entries
  const defaults = [
    'domain analysis',
    'problem solving',
    'best practices',
    'collaboration',
  ];
  while (expertise.length < 3) {
    const next = defaults.shift();
    if (next && !expertise.includes(next)) {
      expertise.push(next);
    }
  }

  return expertise;
}

function inferTaskTypes(name: string, description: string): string[] {
  const combined = `${name} ${description}`.toLowerCase();
  const types: string[] = [];

  const patterns: Array<[RegExp, string]> = [
    [/security|vuln|audit/, 'security-audit'],
    [/review/, 'code-review'],
    [/test|tdd/, 'test-implementation'],
    [/deploy|devops|ci/, 'deployment'],
    [/architect|design/, 'architecture-design'],
    [/implement|code|develop/, 'feature-implementation'],
    [/document|write/, 'documentation'],
    [/database|query|schema/, 'database-optimization'],
    [/research|analy/, 'research'],
    [/plan|orchestr|coord/, 'task-planning'],
    [/performance|optim/, 'performance-optimization'],
  ];

  for (const [pattern, taskType] of patterns) {
    if (pattern.test(combined)) {
      types.push(taskType);
    }
  }

  if (types.length === 0) {
    types.push('general-task');
  }

  return types;
}

function inferOutputType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('review')) return 'CodeReviewReport';
  if (lower.includes('test')) return 'TestSuite';
  if (lower.includes('architect') || lower.includes('design')) return 'ArchitectureDesign';
  if (lower.includes('security') || lower.includes('audit')) return 'SecurityAuditReport';
  if (lower.includes('document') || lower.includes('writer')) return 'TechnicalDocumentation';
  if (lower.includes('research')) return 'ResearchReport';
  if (lower.includes('plan')) return 'ExecutionPlan';
  if (lower.includes('database')) return 'DatabaseOptimizationReport';
  if (lower.includes('devops') || lower.includes('deploy')) return 'InfrastructureConfig';
  if (lower.includes('coordinator') || lower.includes('swarm')) return 'SwarmOrchestrationResult';
  return 'CodeImplementation';
}

export function generateCapabilityTemplate(
  name: string,
  description: string
): string {
  const role = toKebabCase(name);
  const goal = description.length >= 20
    ? description.slice(0, 200)
    : `Perform ${name.toLowerCase()} tasks effectively and reliably`;
  const expertise = inferExpertise(description);
  const taskTypes = inferTaskTypes(name, description);
  const outputType = inferOutputType(name);

  const expertiseYaml = expertise.map((e) => `    - ${e}`).join('\n');
  const taskTypesYaml = taskTypes.map((t) => `    - ${t}`).join('\n');

  return `capability:
  role: ${role}
  goal: ${goal}
  version: "1.0.0"
  expertise:
${expertiseYaml}
  task_types:
${taskTypesYaml}
  output_type: ${outputType}`;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npx ts-node scripts/add-capability-template.ts <agent-file.md>');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, 'utf-8');

  if (content.includes('capability:')) {
    console.error('This file already has a capability block.');
    process.exit(1);
  }

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    console.error('Could not parse frontmatter from file.');
    process.exit(1);
  }

  const template = generateCapabilityTemplate(
    frontmatter.name,
    frontmatter.description
  );

  console.log(`\n# Generated capability template for: ${frontmatter.name}`);
  console.log(`# Add this block inside the YAML frontmatter before the closing ---\n`);
  console.log(template);
  console.log('');
}

// Run when executed directly
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('add-capability-template.ts') ||
   process.argv[1].endsWith('add-capability-template.js'));

if (isDirectRun) {
  main();
}
