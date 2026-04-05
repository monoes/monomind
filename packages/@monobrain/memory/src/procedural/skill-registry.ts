/**
 * SkillRegistry — JSONL-backed registry for learned skills.
 *
 * Part of Task 45 — Procedural Memory.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { LearnedSkill } from './types.js';

export class SkillRegistry {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** Register a new learned skill */
  register(skill: LearnedSkill): void {
    appendFileSync(this.filePath, JSON.stringify(skill) + '\n', 'utf-8');
  }

  /** List all registered skills */
  list(): LearnedSkill[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line) as LearnedSkill);
  }

  /** Get a skill by ID */
  get(skillId: string): LearnedSkill | undefined {
    return this.list().find((s) => s.skillId === skillId);
  }

  /**
   * Find a skill that matches the same fingerprint (agentSlug + tool sequence).
   * Fingerprint = agentSlug + sorted tool names joined by " -> ".
   */
  findByFingerprint(skill: LearnedSkill): LearnedSkill | undefined {
    const fp = this.buildFingerprint(skill);
    return this.list().find((s) => this.buildFingerprint(s) === fp);
  }

  /** Update a skill by ID (rewrites the entire file) */
  update(skillId: string, updated: LearnedSkill): void {
    const all = this.list();
    const idx = all.findIndex((s) => s.skillId === skillId);
    if (idx === -1) return;
    all[idx] = updated;
    writeFileSync(this.filePath, all.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf-8');
  }

  private buildFingerprint(skill: LearnedSkill): string {
    const toolChain = skill.actionSequence.map((a) => a.toolName).join(' -> ');
    return `${skill.agentSlug}::${toolChain}`;
  }
}
