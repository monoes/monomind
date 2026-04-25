import { RouteResult } from './types.js';

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
 * 30+ default keyword rules for fast, deterministic routing.
 * First-match wins — order matters.
 */
export const DEFAULT_KEYWORD_ROUTES: KeywordRule[] = [
  // Security / CVE
  { pattern: /CVE-\d{4}-\d+/i, agentSlug: 'engineering-security-engineer', routeName: 'cve-remediation', description: 'CVE identifier detected' },
  { pattern: /\bOWASP\b/i, agentSlug: 'engineering-security-engineer', routeName: 'owasp-security', description: 'OWASP security reference' },
  { pattern: /\bthreat\s*model/i, agentSlug: 'engineering-security-engineer', routeName: 'threat-modeling', description: 'Threat modeling task' },

  // Test files
  { pattern: /\.(test|spec)\.(ts|js|tsx|jsx)\b/i, agentSlug: 'tdd-london-swarm', routeName: 'test-file', description: 'Test file detected' },
  { pattern: /\b(write|create|add|fix)\s+(unit|integration|e2e)?\s*tests?\b/i, agentSlug: 'tdd-london-swarm', routeName: 'test-writing', description: 'Test writing task' },

  // Docker / DevOps
  { pattern: /\bDockerfile\b/i, agentSlug: 'engineering-devops-automator', routeName: 'dockerfile', description: 'Dockerfile detected' },
  { pattern: /\bdocker[-.]?compose\b/i, agentSlug: 'engineering-devops-automator', routeName: 'docker-compose', description: 'Docker Compose detected' },
  { pattern: /\bterraform\b/i, agentSlug: 'engineering-devops-automator', routeName: 'terraform', description: 'Terraform infrastructure' },
  { pattern: /\bgithub\s*actions?\b/i, agentSlug: 'engineering-devops-automator', routeName: 'github-actions', description: 'GitHub Actions workflow' },
  { pattern: /\b\.github\/workflows\b/i, agentSlug: 'engineering-devops-automator', routeName: 'github-workflows', description: 'GitHub workflow file' },
  { pattern: /\bkubernetes\b|\bk8s\b|\bhelm\b/i, agentSlug: 'engineering-devops-automator', routeName: 'kubernetes', description: 'Kubernetes / Helm' },

  // Git operations
  { pattern: /\bgit\s+(rebase|blame|bisect|cherry-pick|stash|reflog)\b/i, agentSlug: 'engineering-git-workflow-master', routeName: 'git-operations', description: 'Advanced git operation' },
  { pattern: /\bgit\s+(merge|branch|tag|log|diff)\b/i, agentSlug: 'engineering-git-workflow-master', routeName: 'git-workflow', description: 'Git workflow operation' },

  // Solidity / Smart contracts
  { pattern: /\.sol\b/i, agentSlug: 'engineering-solidity-smart-contract-engineer', routeName: 'solidity-file', description: 'Solidity file detected' },
  { pattern: /\bsolidity\b|\bsmart\s*contract\b/i, agentSlug: 'engineering-solidity-smart-contract-engineer', routeName: 'solidity', description: 'Solidity / smart contract' },

  // ZK proofs
  { pattern: /\bzkp\b|\bcircom\b|\bsnark\b|\bzk[-\s]?proof/i, agentSlug: 'zk-steward', routeName: 'zk-proofs', description: 'Zero-knowledge proof' },

  // MCP
  { pattern: /\bMCP\s*(server|builder|tool)\b/i, agentSlug: 'specialized-mcp-builder', routeName: 'mcp-builder', description: 'MCP server/tool building' },

  // React Native / Mobile
  { pattern: /\breact[-\s]?native\b/i, agentSlug: 'engineering-react-native-developer', routeName: 'react-native', description: 'React Native development' },

  // iOS / Swift
  { pattern: /\bswift\b|\bswiftui\b|\bxcode\b|\bios\s+app\b/i, agentSlug: 'engineering-ios-swift-developer', routeName: 'ios-swift', description: 'iOS / Swift development' },

  // Android / Kotlin
  { pattern: /\bkotlin\b|\bandroid\s+(app|dev)/i, agentSlug: 'engineering-android-kotlin-developer', routeName: 'android-kotlin', description: 'Android / Kotlin development' },

  // Embedded / Firmware
  { pattern: /\bfirmware\b|\bembedded\b|\brtos\b|\bmicrocontroller\b/i, agentSlug: 'engineering-embedded-firmware-engineer', routeName: 'embedded-firmware', description: 'Embedded / firmware development' },

  // Salesforce
  { pattern: /\bsalesforce\b|\bapex\b|\bsoql\b/i, agentSlug: 'specialized-salesforce-developer', routeName: 'salesforce', description: 'Salesforce / Apex / SOQL' },

  // Game engines
  { pattern: /\bblender\b/i, agentSlug: 'specialized-blender-3d-artist', routeName: 'blender', description: 'Blender 3D modeling' },
  { pattern: /\bunreal\s*engine\b|\bUE[45]\b/i, agentSlug: 'specialized-unreal-engine-developer', routeName: 'unreal-engine', description: 'Unreal Engine development' },
  { pattern: /\bunity\b|\bC#\s*game\b/i, agentSlug: 'specialized-unity-developer', routeName: 'unity', description: 'Unity game development' },
  { pattern: /\bgodot\b|\bgdscript\b/i, agentSlug: 'specialized-godot-developer', routeName: 'godot', description: 'Godot game development' },

  // SEO
  { pattern: /\bSEO\b|\bsearch\s*engine\s*optim/i, agentSlug: 'specialized-seo-strategist', routeName: 'seo', description: 'SEO optimization' },

  // Supply chain
  { pattern: /\bsupply[-\s]?chain\b|\bSBOM\b/i, agentSlug: 'engineering-supply-chain-security', routeName: 'supply-chain', description: 'Supply chain security' },

  // GraphQL
  { pattern: /\bgraphql\b|\b\.graphql\b|\b\.gql\b/i, agentSlug: 'engineering-graphql-developer', routeName: 'graphql', description: 'GraphQL development' },

  // Database / SQL
  { pattern: /\bpostgres\b|\bmysql\b|\bmongodb\b|\bredis\b/i, agentSlug: 'engineering-database-engineer', routeName: 'database', description: 'Database engineering' },
];

/**
 * Fast keyword-based pre-filter for routing.
 * Runs regex matches against task descriptions before falling through
 * to semantic (embedding-based) routing. First match wins.
 */
export class KeywordPreFilter {
  private rules: KeywordRule[];

  constructor(customRules?: Array<{ pattern: RegExp; agentSlug: string; routeName: string; description: string }>) {
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
