import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createClaudeLLMCaller } from '../../routing/llm-caller.js';
const SYSTEM_PROMPT = `You are a browser automation expert. Given a DOM snippet and a task description, generate a JSON action definition that automates the task.

Rules:
- Use ONLY these step types: navigate, find, click, type, wait, extract
- For "find" steps, provide 2-3 selector alternatives in order of preference (CSS, aria-label, XPath)
- For "type" steps, set humanDelay: true for form inputs
- Parameters use {{params.name}} syntax
- The action id format is "custom:<snake_case_name>"
- Output ONLY a JSON code block, no explanation before or after

JSON schema:
{
  "id": "custom:action_name",
  "platform": "custom",
  "name": "Human Readable Name",
  "params": ["param1", "param2"],
  "steps": [...]
}`;
export function buildPrompt(task, domSnapshot) {
    const truncated = domSnapshot.slice(0, 8000);
    return `Task: ${task}\n\nDOM snapshot:\n${truncated}\n\nGenerate the action JSON.`;
}
export function parseActionResponse(response) {
    const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match)
        throw new Error('No JSON block found in Claude response');
    try {
        return JSON.parse(match[1].trim());
    }
    catch (err) {
        throw new Error(`Invalid JSON in response: ${err.message}`);
    }
}
export async function analyzeAndBuild(options) {
    const { url, task, client, sessionId, outputDir } = options;
    // Navigate to the URL and wait for load
    await client.send('Page.navigate', { url }, sessionId);
    await new Promise(r => setTimeout(r, 2500)); // allow page to settle
    // Capture DOM snapshot — accessibility tree + visible text
    const domResult = await client.send('DOM.getDocument', { depth: 3, pierce: true }, sessionId);
    const outerHtml = await client.send('DOM.getOuterHTML', { nodeId: domResult.root.nodeId }, sessionId);
    // Strip scripts/styles, keep interactive elements
    const cleanDom = outerHtml.outerHTML
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/\s{2,}/g, ' ')
        .slice(0, 12000);
    // Call Claude via the CLI (reuses Claude Code's auth — no API key needed)
    const caller = createClaudeLLMCaller({ model: 'sonnet' });
    if (!caller)
        throw new Error('Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
    const responseText = await caller(`${SYSTEM_PROMPT}\n\n${buildPrompt(task, cleanDom)}`);
    const action = parseActionResponse(responseText);
    // Write to output directory
    await mkdir(outputDir, { recursive: true });
    const filename = action.id.replace(/[^a-z0-9_-]/gi, '_') + '.json';
    const outPath = join(outputDir, filename);
    await writeFile(outPath, JSON.stringify(action, null, 2));
    return action;
}
//# sourceMappingURL=analyzer.js.map