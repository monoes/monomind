import type { RouteResult } from './types.js';

export interface KeywordRule {
  /** Regex pattern to match against task description */
  pattern: RegExp;
  /** Agent slug to route to when matched */
  agentSlug: string;
  /** Human-readable name for this route */
  routeName: string;
  /** Description of what this rule matches */
  description: string;
}

/**
 * Default keyword rules for fast, deterministic routing. Every agentSlug is a
 * spawnable agent name (a bundled agent's frontmatter `name`).
 * First-match wins — order matters.
 */
export const DEFAULT_KEYWORD_ROUTES: KeywordRule[] = [
  // Security / CVE
  {
    pattern: /CVE-\d{4}-\d+/i,
    agentSlug: 'Security Engineer',
    routeName: 'cve-remediation',
    description: 'CVE identifier detected',
  },
  {
    pattern: /\bOWASP\b/i,
    agentSlug: 'Security Engineer',
    routeName: 'owasp-security',
    description: 'OWASP security reference',
  },
  {
    pattern: /\bthreat\s*model/i,
    agentSlug: 'Security Engineer',
    routeName: 'threat-modeling',
    description: 'Threat modeling task',
  },

  // Test files
  {
    pattern: /\.(test|spec)\.(ts|js|tsx|jsx)\b/i,
    agentSlug: 'tdd-london-monoswarm',
    routeName: 'test-file',
    description: 'Test file detected',
  },
  {
    pattern: /\b(write|create|add|fix)\s+(unit|integration|e2e)?\s*tests?\b/i,
    agentSlug: 'tdd-london-monoswarm',
    routeName: 'test-writing',
    description: 'Test writing task',
  },

  // Docker / DevOps
  {
    pattern: /\bDockerfile\b/i,
    agentSlug: 'DevOps Automator',
    routeName: 'dockerfile',
    description: 'Dockerfile detected',
  },
  {
    pattern: /\bdocker[-.]?compose\b/i,
    agentSlug: 'DevOps Automator',
    routeName: 'docker-compose',
    description: 'Docker Compose detected',
  },
  {
    pattern: /\bterraform\b/i,
    agentSlug: 'DevOps Automator',
    routeName: 'terraform',
    description: 'Terraform infrastructure',
  },
  {
    pattern: /\bgithub\s*actions?\b/i,
    agentSlug: 'DevOps Automator',
    routeName: 'github-actions',
    description: 'GitHub Actions workflow',
  },
  {
    pattern: /\b\.github\/workflows\b/i,
    agentSlug: 'DevOps Automator',
    routeName: 'github-workflows',
    description: 'GitHub workflow file',
  },
  {
    pattern:
      /\bkubernetes\b|\bk8s\b|\bhelm\b(?=[\s\S]{0,60}\b(?:kubernetes|k8s|chart|deploy|helmfile)\b)|\b(?:kubernetes|k8s|chart|deploy|helmfile)\b(?=[\s\S]{0,60}\bhelm\b)/i,
    agentSlug: 'DevOps Automator',
    routeName: 'kubernetes',
    description:
      'Kubernetes / Helm (bare "helm" requires nearby Kubernetes context — "take the helm" is not Kubernetes)',
  },

  // Git operations
  {
    pattern: /\bgit\s+(rebase|blame|bisect|cherry-pick|stash|reflog)\b/i,
    agentSlug: 'Git Workflow Master',
    routeName: 'git-operations',
    description: 'Advanced git operation',
  },
  {
    pattern: /\bgit\s+(merge|branch|tag|log|diff)\b/i,
    agentSlug: 'Git Workflow Master',
    routeName: 'git-workflow',
    description: 'Git workflow operation',
  },

  // Solidity / Smart contracts
  {
    pattern: /\.sol\b/i,
    agentSlug: 'Solidity Smart Contract Engineer',
    routeName: 'solidity-file',
    description: 'Solidity file detected',
  },
  {
    pattern: /\bsolidity\b|\bsmart\s*contract\b/i,
    agentSlug: 'Solidity Smart Contract Engineer',
    routeName: 'solidity',
    description: 'Solidity / smart contract',
  },

  // MCP
  {
    pattern: /\bMCP\s*(server|builder|tool)\b/i,
    agentSlug: 'MCP Builder',
    routeName: 'mcp-builder',
    description: 'MCP server/tool building',
  },

  // React Native / Mobile
  {
    pattern: /\breact[-\s]?native\b/i,
    agentSlug: 'mobile-dev',
    routeName: 'react-native',
    description: 'React Native development',
  },

  // iOS / Swift
  // Bare "swift" is a common English word ("a swift fix") — only match it when
  // iOS/Xcode/Apple context appears nearby (either word order). swiftui/xcode/
  // "ios app" are already unambiguous domain qualifiers.
  {
    pattern:
      /\bswiftui\b|\bxcode\b|\bios\s+app\b|\bswift\b(?=[\s\S]{0,60}\b(?:ios|xcode|apple|app)\b)|\b(?:ios|xcode|apple|app)\b(?=[\s\S]{0,60}\bswift\b)/i,
    agentSlug: 'Mobile App Builder',
    routeName: 'ios-swift',
    description: 'iOS / Swift development',
  },

  // Android / Kotlin
  {
    pattern: /\bkotlin\b|\bandroid\s+(app|dev)/i,
    agentSlug: 'Mobile App Builder',
    routeName: 'android-kotlin',
    description: 'Android / Kotlin development',
  },

  // Embedded / Firmware
  // Bare "embedded" is a common English word ("the config embedded in the file")
  // — only match it near hardware/firmware context (either word order).
  {
    pattern:
      /\bfirmware\b|\brtos\b|\bmicrocontroller\b|\bembedded\b(?=[\s\S]{0,60}\b(?:firmware|hardware|mcu|rtos|chip|microcontroller|device|system)\b)|\b(?:firmware|hardware|mcu|rtos|chip|microcontroller|device|system)\b(?=[\s\S]{0,60}\bembedded\b)/i,
    agentSlug: 'Embedded Firmware Engineer',
    routeName: 'embedded-firmware',
    description: 'Embedded / firmware development',
  },

  // SEO
  {
    pattern: /\bSEO\b|\bsearch\s*engine\s*optim/i,
    agentSlug: 'Competitive Content Strategist',
    routeName: 'seo',
    description: 'SEO optimization',
  },

  // Supply chain
  {
    pattern: /\bsupply[-\s]?chain\b|\bSBOM\b/i,
    agentSlug: 'Security Engineer',
    routeName: 'supply-chain',
    description: 'Supply chain security',
  },

  // GraphQL
  {
    pattern: /\bgraphql\b|\b\.graphql\b|\b\.gql\b/i,
    agentSlug: 'Backend Architect',
    routeName: 'graphql',
    description: 'GraphQL development',
  },

  // Database / SQL
  {
    pattern: /\bpostgres\b|\bmysql\b|\bmongodb\b|\bredis\b/i,
    agentSlug: 'Database Optimizer',
    routeName: 'database',
    description: 'Database engineering',
  },
];

/**
 * Fast keyword-based pre-filter for routing.
 * Runs regex matches against task descriptions before falling through
 * to semantic (embedding-based) routing. First match wins.
 */
export class KeywordPreFilter {
  private rules: KeywordRule[];

  constructor(
    customRules?: Array<{
      pattern: RegExp;
      agentSlug: string;
      routeName: string;
      description: string;
    }>,
  ) {
    this.rules = [...DEFAULT_KEYWORD_ROUTES];
    if (customRules) {
      // Prepend custom rules so they take priority
      this.rules = [...customRules, ...this.rules];
    }
  }

  /**
   * Match a task description against keyword rules.
   * Returns the first matching route or null if no keyword matches.
   */
  match(taskDescription: string): RouteResult | null {
    for (const rule of this.rules) {
      if (rule.pattern.test(taskDescription)) {
        return {
          agentSlug: rule.agentSlug,
          confidence: 1.0,
          method: 'keyword',
          routeName: rule.routeName,
        };
      }
    }
    return null;
  }

  /**
   * Prepend a custom rule (highest priority).
   */
  addRule(rule: KeywordRule): void {
    this.rules.unshift(rule);
  }

  /**
   * Return a copy of the current rules (immutable view).
   */
  getRules(): ReadonlyArray<KeywordRule> {
    return [...this.rules];
  }
}
