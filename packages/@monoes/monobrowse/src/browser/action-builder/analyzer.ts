// src/browser/action-builder/analyzer.ts
import { spawn } from 'child_process';
import type { ActionDef } from './types.js';

export interface AnalyzerPage {
  evaluate<T>(expression: string): Promise<T>;
  url(): Promise<string>;
}

// monolean: no options needed — routes through claude --print, no API key required
export interface AnalyzerOptions {
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

function claudeCliCall(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['--print', '--model', 'haiku', '--strict-mcp-config', '--no-session-persistence', '--', prompt],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error('claude --print timed out after 60s'));
    }, 60_000);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`claude CLI not found — is Claude Code installed? (${(err as NodeJS.ErrnoException).code})`));
    });
  });
}

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

  const fullPrompt = `${SYSTEM_PROMPT}\n\nTask: ${task}\n\nPage context:\n${domContext}`;
  const responseText = await claudeCliCall(fullPrompt);

  let actionDef: ActionDef;
  try {
    actionDef = JSON.parse(responseText) as ActionDef;
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${responseText.slice(0, 500)}`);
  }

  if (!actionDef.id || !actionDef.steps || !Array.isArray(actionDef.steps)) {
    throw new Error(`Claude returned invalid ActionDef: missing id or steps\n${responseText.slice(0, 500)}`);
  }

  return actionDef;
}
