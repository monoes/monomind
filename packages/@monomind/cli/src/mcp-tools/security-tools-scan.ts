import { capSecurityInput, getMonoFence, MAX_SECURITY_K } from './security-tools-core.js';
import type { MCPTool, MCPToolResult } from './types.js';

/**
 * Scan input for AI manipulation threats
 */
export const monofenceScanTool: MCPTool = {
  name: 'monofence_scan',
  description:
    'Scan input text for AI manipulation threats (prompt injection, jailbreaks, PII). Returns threat assessment with <10ms latency.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to scan for threats',
      },
      quick: {
        type: 'boolean',
        description: 'Quick scan mode (faster, less detailed)',
        default: false,
      },
    },
    required: ['input'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    let input: string;
    try {
      input = capSecurityInput(args.input);
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: (e as Error).message }) }],
        isError: true,
      };
    }
    const quick = args.quick as boolean;

    try {
      const defender = await getMonoFence();

      if (quick) {
        const result = defender.quickScan(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  safe: !result.threat,
                  threatDetected: result.threat,
                  confidence: result.confidence,
                  mode: 'quick',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await defender.detect(input);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                safe: result.safe,
                threats: result.threats.map(
                  (t: {
                    type: string;
                    severity: string;
                    confidence: number;
                    description: string;
                  }) => ({
                    type: t.type,
                    severity: t.severity,
                    confidence: t.confidence,
                    description: t.description,
                  }),
                ),
                piiFound: result.piiFound,
                detectionTimeMs: result.detectionTimeMs,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Deep analysis of specific threat
 */
export const monofenceAnalyzeTool: MCPTool = {
  name: 'monofence_analyze',
  description:
    'Deep analysis of input for specific threat types with similar pattern search and mitigation recommendations.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to analyze',
      },
      searchSimilar: {
        type: 'boolean',
        description: 'Search for similar known threats',
        default: true,
      },
      k: {
        type: 'number',
        description: 'Number of similar patterns to retrieve',
        default: 5,
      },
    },
    required: ['input'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    let input: string;
    try {
      input = capSecurityInput(args.input);
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: (e as Error).message }) }],
        isError: true,
      };
    }
    const searchSimilar = args.searchSimilar !== false;
    const rawK = (args.k as number) || 5;
    const k = Number.isFinite(rawK) && rawK > 0 ? Math.min(Math.floor(rawK), MAX_SECURITY_K) : 5;

    try {
      const defender = await getMonoFence();
      const result = await defender.detect(input);

      const analysis: Record<string, unknown> = {
        detection: {
          safe: result.safe,
          threats: result.threats,
          piiFound: result.piiFound,
        },
        mitigations: [] as Array<{ threatType: string; strategy: string; effectiveness: number }>,
        similarPatterns: [] as Array<unknown>,
      };

      // Get mitigations for detected threats
      for (const threat of result.threats) {
        const mitigation = await defender.getBestMitigation(
          threat.type as Parameters<typeof defender.getBestMitigation>[0],
        );
        if (mitigation) {
          (analysis.mitigations as Array<unknown>).push({
            threatType: threat.type,
            strategy: mitigation.strategy,
            effectiveness: mitigation.effectiveness,
          });
        }
      }

      // Search similar patterns
      if (searchSimilar) {
        const similar = await defender.searchSimilarThreats(input, { k });
        analysis.similarPatterns = similar.map(
          (p: { pattern: string; type: string; effectiveness: number }) => ({
            pattern: p.pattern,
            type: p.type,
            effectiveness: p.effectiveness,
          }),
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};
