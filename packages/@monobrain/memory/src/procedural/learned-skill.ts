/**
 * LearnedSkillSerializer — Creates and serializes LearnedSkill objects.
 *
 * Part of Task 45 — Procedural Memory.
 */

import { randomUUID } from 'crypto';
import type { ActionRecord, LearnedSkill } from './types.js';

export class LearnedSkillSerializer {
  /**
   * Create a new LearnedSkill from extracted data.
   */
  static create(
    name: string,
    agentSlug: string,
    triggerPattern: string,
    actionSequence: ActionRecord[],
    successCount: number,
    avgQualityScore: number,
    sourceRunIds: string[],
  ): LearnedSkill {
    const now = new Date().toISOString();
    return {
      skillId: randomUUID(),
      name,
      agentSlug,
      trigger: {
        pattern: triggerPattern,
        mode: 'exact',
        minConfidence: 0.8,
      },
      actionSequence,
      successCount,
      avgQualityScore,
      sourceRunIds,
      createdAt: now,
      lastUpdatedAt: now,
      version: 1,
    };
  }

  /**
   * Serialize a LearnedSkill to a markdown string with YAML frontmatter.
   */
  static toMarkdown(skill: LearnedSkill): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push(`skill_id: ${skill.skillId}`);
    lines.push(`name: ${skill.name}`);
    lines.push(`agent_slug: ${skill.agentSlug}`);
    lines.push(`success_count: ${skill.successCount}`);
    lines.push(`avg_quality_score: ${skill.avgQualityScore}`);
    lines.push(`version: ${skill.version}`);
    lines.push(`created_at: ${skill.createdAt}`);
    lines.push(`last_updated_at: ${skill.lastUpdatedAt}`);
    lines.push(`source_run_ids: [${skill.sourceRunIds.join(', ')}]`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${skill.name}`);
    lines.push('');
    lines.push('## Trigger');
    lines.push('');
    lines.push(`- Pattern: \`${skill.trigger.pattern}\``);
    lines.push(`- Mode: ${skill.trigger.mode}`);
    lines.push(`- Min Confidence: ${skill.trigger.minConfidence}`);
    lines.push('');
    lines.push('## Action Sequence');
    lines.push('');
    for (let i = 0; i < skill.actionSequence.length; i++) {
      const step = skill.actionSequence[i];
      lines.push(`### Step ${i + 1}: ${step.toolName}`);
      lines.push('');
      lines.push(`- Tool: \`${step.toolName}\``);
      lines.push(`- Outcome: ${step.outcome}`);
      lines.push(`- Duration: ${step.durationMs}ms`);
      if (step.qualityScore !== undefined) {
        lines.push(`- Quality: ${step.qualityScore}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}
