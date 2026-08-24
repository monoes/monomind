/** The sole lookup table for all declarative platform renderers. */

import type { PlatformId } from '../types.js';
import { aiderRenderer } from './aider.js';
import { antigravityRenderer } from './antigravity.js';
import { claudeRenderer } from './claude.js';
import { codexRenderer } from './codex.js';
import { copilotRenderer } from './copilot.js';
import { cursorRenderer } from './cursor.js';
import { droidRenderer } from './droid.js';
import { EXPERIMENTAL_RENDERERS } from './experimental.js';
import type { PlatformRenderer } from './factory.js';
import { geminiRenderer } from './gemini.js';
import { kimiRenderer } from './kimi.js';
import { kiroRenderer } from './kiro.js';
import { openclawRenderer } from './openclaw.js';
import { opencodeRenderer } from './opencode.js';
import { vscodeRenderer } from './vscode.js';
import { zedRenderer } from './zed.js';

export type { PlatformRenderer } from './factory.js';
export { createPlatformRenderer, renderPlatformPlan } from './factory.js';

export const RENDERERS: Readonly<Record<PlatformId, PlatformRenderer>> = Object.freeze({
  claude: claudeRenderer,
  gemini: geminiRenderer,
  cursor: cursorRenderer,
  vscode: vscodeRenderer,
  copilot: copilotRenderer,
  opencode: opencodeRenderer,
  aider: aiderRenderer,
  kiro: kiroRenderer,
  trae: EXPERIMENTAL_RENDERERS.trae,
  openclaw: openclawRenderer,
  droid: droidRenderer,
  antigravity: antigravityRenderer,
  hermes: EXPERIMENTAL_RENDERERS.hermes,
  codex: codexRenderer,
  kimi: kimiRenderer,
  zed: zedRenderer,
});

export function getRenderer(platform: PlatformId): PlatformRenderer {
  return RENDERERS[platform];
}
