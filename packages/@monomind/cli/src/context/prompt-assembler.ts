/**
 * PromptAssembler — collects context sections from multiple providers,
 * prioritises them within a token budget, and concatenates the result
 * with the base prompt.
 */

import type { ContextProvider, RunContext } from './context-provider.js';

export interface AssemblyConfig {
  maxTotalTokens?: number;
  basePromptTokens: number;
  providers: ContextProvider[];
}

export interface AssembledPrompt {
  content: string;
  sectionsIncluded: string[];
  sectionsTruncated: string[];
  sectionsDropped: string[];
  totalTokenEstimate: number;
}

const DEFAULT_MAX_TOTAL_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;
const SECTION_SEPARATOR = '\n\n---\n\n';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

interface ResolvedSection {
  name: string;
  content: string;
  tokens: number;
  priority: number;
  required: boolean;
}

export class PromptAssembler {
  private readonly maxTotalTokens: number;
  private readonly basePromptTokens: number;
  private readonly providers: ContextProvider[];

  constructor(config: AssemblyConfig) {
    this.maxTotalTokens = config.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
    this.basePromptTokens = config.basePromptTokens;
    this.providers = config.providers;
  }

  async assemble(
    basePrompt: string,
    ctx: RunContext,
  ): Promise<AssembledPrompt> {
    // 1. Call all providers concurrently
    const settled = await Promise.allSettled(
      this.providers.map(async (p) => {
        const content = await p.provide(ctx);
        return {
          name: p.name,
          content,
          tokens: estimateTokens(content),
          priority: p.priority,
          required: p.required,
        } satisfies ResolvedSection;
      }),
    );

    // 2. Filter out rejected / empty results
    const sections: ResolvedSection[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value.content.length > 0) {
        sections.push(result.value);
      }
    }

    // 3. Sort by priority descending
    sections.sort((a, b) => b.priority - a.priority);

    // 4. Fit within budget
    const budget = this.maxTotalTokens - this.basePromptTokens;
    let remaining = budget;

    const included: ResolvedSection[] = [];
    const truncated: string[] = [];
    const dropped: string[] = [];

    for (const section of sections) {
      if (section.tokens <= remaining) {
        // Fits entirely
        included.push(section);
        remaining -= section.tokens;
      } else if (section.required) {
        // Required but exceeds remaining — truncate to fit
        const truncatedContent = truncateToTokens(section.content, remaining);
        included.push({
          ...section,
          content: truncatedContent,
          tokens: estimateTokens(truncatedContent),
        });
        truncated.push(section.name);
        remaining -= estimateTokens(truncatedContent);
      } else {
        // Optional and doesn't fit — drop
        dropped.push(section.name);
      }
    }

    // 5. Build final prompt: context sections first, then base prompt
    const contextParts = included.map((s) => s.content);
    const assembled =
      contextParts.length > 0
        ? contextParts.join(SECTION_SEPARATOR) +
          SECTION_SEPARATOR +
          basePrompt
        : basePrompt;

    return {
      content: assembled,
      sectionsIncluded: included.map((s) => s.name),
      sectionsTruncated: truncated,
      sectionsDropped: dropped,
      totalTokenEstimate:
        estimateTokens(assembled),
    };
  }
}
