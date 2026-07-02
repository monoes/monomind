// src/browser/action-builder/analyzer.ts
import type { ActionDef } from './types.js';
const MODEL_DEFAULTS = { sonnet: 'claude-sonnet-4-6' } as const;

export interface AnalyzerPage {
  evaluate<T>(expression: string): Promise<T>;
  url(): Promise<string>;
}

export interface AnalyzerOptions {
  apiKey?: string;
  model?: string;
}

interface DomElement {
  tag: string;
  text: string;
  attrs: {
    id?: string;
    name?: string | null;
    ariaLabel?: string | null;
    type?: string | null;
    href?: string | null;
  };
}

const DOM_CAPTURE_EXPR = `
JSON.stringify(
  Array.from(document.querySelectorAll('button,input,a,textarea,[role="button"]'))
    .slice(0, 100)
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 80) ?? '',
      attrs: {
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        type: el.getAttribute('type') || undefined,
        href: el.tagName === 'A' ? (el.getAttribute('href') || undefined) : undefined
      }
    }))
)`;

const SYSTEM_PROMPT = `You are an expert browser automation engineer. Given a webpage's interactive elements and a task description, generate a browser automation ActionDef JSON.

Rules:
- Output ONLY valid JSON matching the ActionDef schema, no markdown, no explanation
- Use multi-selector find steps: provide CSS selector, aria-label selector, and XPath as fallbacks
- Use {{params.param_name}} for dynamic values the caller will provide
- Steps must be executable in order

ActionDef schema:
{
  "id": "<platform>:<action_name>",
  "platform": "<platform>",
  "name": "<human readable>",
  "params": ["param1", "param2"],
  "steps": [
    { "type": "navigate", "url": "{{params.url}}" },
    { "type": "find", "selectors": ["css-selector", "[aria-label='...']", "//xpath"], "as": "element_name" },
    { "type": "click", "target": "{{element_name}}" },
    { "type": "type", "target": "{{element_name}}", "text": "{{params.text}}", "humanDelay": true },
    { "type": "wait", "condition": "network_idle", "timeout": 3000 },
    { "type": "extract", "target": "{{element_name}}", "as": "result" },
    { "type": "condition", "expression": "{{extracted_value}}", "then": [...steps], "else": [...steps] }
  ]
}`;

export async function analyzePageForAction(
  page: AnalyzerPage,
  task: string,
  options: AnalyzerOptions = {},
): Promise<ActionDef> {
  const url = await page.url();
  const title = await page.evaluate<string>('document.title');
  const elementsJson = await page.evaluate<string>(DOM_CAPTURE_EXPR);

  let elements: DomElement[] = [];
  try {
    elements = JSON.parse(elementsJson) as DomElement[];
  } catch {
    elements = [];
  }

  const domContext = `URL: ${url}
Title: ${title}
Interactive elements (${elements.length}):
${elements.map((el, i) => {
  const attrs = Object.entries(el.attrs)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `${i + 1}. <${el.tag}${attrs ? ' ' + attrs : ''}>${el.text}</${el.tag}>`;
}).join('\n')}`;

  // monolean: dynamic import so missing SDK doesn't crash module load when SDK is absent
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('analyzePageForAction requires @anthropic-ai/sdk — install it: npm install @anthropic-ai/sdk');
  });
  const client = new Anthropic({ apiKey: options.apiKey ?? process.env['ANTHROPIC_API_KEY'] });
  const model = options.model ?? MODEL_DEFAULTS.sonnet;

  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Task: ${task}\n\nPage context:\n${domContext}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude returned non-text response');

  let actionDef: ActionDef;
  try {
    actionDef = JSON.parse(content.text) as ActionDef;
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${content.text.slice(0, 500)}`);
  }

  if (!actionDef.id || !actionDef.steps || !Array.isArray(actionDef.steps)) {
    throw new Error(`Claude returned invalid ActionDef: missing id or steps\n${content.text.slice(0, 500)}`);
  }

  return actionDef;
}
