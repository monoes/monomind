/**
 * CLI Security Command
 * Security scanning, CVE detection, threat modeling, vulnerability management
 *
 * github.com/monoes/monomind
 */

import { output } from '../output.js';
import type { Command, CommandResult } from '../types.js';
import { cveCommand } from './security-cve.js';
import { auditCommand, defendCommand, redteamCommand } from './security-misc.js';
import { scanCommand, secretsCommand } from './security-scan.js';

export const securityCommand: Command = {
  name: 'security',
  description: 'Security scanning, CVE detection, threat modeling, AI defense',
  subcommands: [
    scanCommand,
    cveCommand,
    auditCommand,
    secretsCommand,
    defendCommand,
    redteamCommand,
  ],
  examples: [
    { command: 'monomind security scan', description: 'Run security scan' },
    { command: 'monomind security cve --list', description: 'List known CVEs' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('MonoMind Security Suite'));
    output.writeln(output.dim('Comprehensive security scanning and vulnerability management'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'scan     - Run security scans on code, deps, containers',
      'cve      - Check and manage CVE vulnerabilities',
      'audit    - Security audit logging and compliance',
      'secrets  - Detect and manage secrets in codebase',
      'defend   - AI manipulation defense (prompt injection, jailbreaks, PII)',
      'redteam  - Red-team prompt library for manual review (dry-run only, no live attacks)',
    ]);
    output.writeln();
    output.writeln('Use --help with subcommands for more info');
    output.writeln();
    output.writeln(output.dim('github.com/monoes/monomind'));
    return { success: true };
  },
};

export default securityCommand;
