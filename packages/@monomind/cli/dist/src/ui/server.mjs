import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { collectAll, getWatchPaths, collectProject, collectSessions, collectSwarm, collectSwarmHistory, appendSwarmHistory, collectSwarmEvents, getSwarmDataSize, cleanSwarmData, collectAgents, collectTokens, collectHooks, collectKnowledge, collectMetrics, collectMemory, collectMemoryFiles, collectSystem } from './collector.mjs';
import { addSseClient, removeSseClient, broadcast, getSseClientCount, closeSseClients, addMmClient, removeMmClient, broadcastMm, getMmClientCount } from './sse-manager.mjs';

const JSONL_SIZE_CAP = 10 * 1024 * 1024; // 10 MB — skip files larger than this in /api/graph
const buildDocsState = new Map();

// Pricing per token (mirrors token-tracker.cjs FALLBACK_PRICING)
const _SJ_PRICING = {
  'claude-opus-4-8':   { in: 5e-6,    out: 25e-6,   cw: 6.25e-6,  cr: 0.5e-6  },
  'claude-opus-4-6':   { in: 5e-6,    out: 25e-6,   cw: 6.25e-6,  cr: 0.5e-6  },
  'claude-opus-4-5':   { in: 5e-6,    out: 25e-6,   cw: 6.25e-6,  cr: 0.5e-6  },
  'claude-opus-4':     { in: 15e-6,   out: 75e-6,   cw: 18.75e-6, cr: 1.5e-6  },
  'claude-sonnet-4-6': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6  },
  'claude-sonnet-4-5': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6  },
  'claude-sonnet-4':   { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6  },
  'claude-3-7-sonnet': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6  },
  'claude-3-5-sonnet': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6  },
  'claude-haiku-4-5':  { in: 1e-6,    out: 5e-6,    cw: 1.25e-6,  cr: 0.1e-6  },
  'claude-haiku-4':    { in: 0.8e-6,  out: 4e-6,    cw: 1e-6,     cr: 0.08e-6 },
  'claude-3-5-haiku':  { in: 0.8e-6,  out: 4e-6,    cw: 1e-6,     cr: 0.08e-6 },
  'gpt-4o':            { in: 2.5e-6,  out: 10e-6,   cw: 2.5e-6,   cr: 1.25e-6 },
  'gpt-4o-mini':       { in: 0.15e-6, out: 0.6e-6,  cw: 0.15e-6,  cr: 0.075e-6 },
  'gemini-2.5-pro':    { in: 1.25e-6, out: 10e-6,   cw: 1.25e-6,  cr: 0.315e-6 },
};
function _sjGetPricing(model) {
  const _ALIAS = { 'haiku': 'claude-haiku-4-5', 'opus': 'claude-opus-4-6', 'sonnet': 'claude-sonnet-4-6' };
  let canonical = (model || '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  canonical = _ALIAS[canonical] || canonical;
  if (_SJ_PRICING[canonical]) return _SJ_PRICING[canonical];
  for (const k of Object.keys(_SJ_PRICING)) { if (canonical.startsWith(k) || canonical.includes(k)) return _SJ_PRICING[k]; }
  return null;
}
function _sjCalcCost(model, usage) {
  const p = _sjGetPricing(model);
  if (!p || !usage) return 0;
  const webSearch = ((usage.server_tool_use || {}).web_search_requests || 0) * 0.01;
  return (usage.input_tokens || 0) * p.in
       + (usage.output_tokens || 0) * p.out
       + (usage.cache_creation_input_tokens || 0) * p.cw
       + (usage.cache_read_input_tokens || 0) * p.cr
       + webSearch;
} // key: resolved dir → { status, sections, files, error, startedAt, completedAt }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTERMIND_DIAGRAM_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>MASTERMIND — Live Dashboard</title>\n<style>\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body {\n  width: 100%; height: 100%; overflow: hidden;\n  background: #07071a;\n  font-family: 'Azeret Mono', 'Space Mono', 'Courier New', monospace;\n  color: #e0e0ff;\n  user-select: none;\n}\n\n/* ── Main layout ── */\n#app { display: flex; height: 100vh; }\n#sidebar {\n  width: 220px; flex-shrink: 0;\n  background: oklch(9% 0.012 186);\n  border-right: 1px solid oklch(62% 0.2 186 / 0.18);\n  display: flex; flex-direction: column;\n  overflow: hidden; z-index: 10;\n}\n#stage-wrap { flex: 1; position: relative; overflow: hidden; }\n#detail-panel {\n  width: 0; flex-shrink: 0; overflow: hidden;\n  background: oklch(9% 0.012 186);\n  border-left: 1px solid oklch(62% 0.2 186 / 0.18);\n  transition: width 0.3s ease;\n  display: flex; flex-direction: column;\n  z-index: 10;\n}\n#detail-panel.open { width: 280px; }\n#stage { position: absolute; inset: 0; width: 100%; height: 100%; }\n\n/* ── Sidebar ── */\n#sb-header {\n  padding: 14px 14px 10px;\n  border-bottom: 1px solid oklch(62% 0.2 186 / 0.18);\n  flex-shrink: 0;\n}\n#sb-title {\n  font-size: 8px; letter-spacing: 4px; color: oklch(52% 0.1 186); margin-bottom: 4px;\n}\n.live-row { display: flex; align-items: center; gap: 6px; }\n.l-dot {\n  width: 6px; height: 6px; border-radius: 50%;\n  background: #252560; flex-shrink: 0;\n  transition: background 0.5s;\n}\n.l-dot.on { background: #28c068; }\n@media (prefers-reduced-motion: no-preference) { .l-dot.on { animation: ldp 2s ease-in-out infinite; } }\n@keyframes ldp { 0%,100%{opacity:1} 50%{opacity:0.4} }\n#l-status { font-size: 9px; letter-spacing: 2px; color: oklch(44% 0.08 186); }\n#l-agents { font-size: 8px; color: oklch(40% 0.07 186); margin-left: auto; }\n#sb-sessions {\n  flex: 1; overflow-y: auto; padding: 8px 0;\n  scrollbar-width: thin; scrollbar-color: oklch(62% 0.2 186 / 0.3) transparent;\n}\n#sb-sessions::-webkit-scrollbar { width: 4px; }\n#sb-sessions::-webkit-scrollbar-thumb { background: oklch(62% 0.2 186 / 0.3); border-radius: 2px; }\n.sess-item {\n  padding: 8px 14px; cursor: pointer;\n  border-left: 2px solid transparent;\n  transition: background 0.15s, border-color 0.15s;\n}\n.sess-item:hover { background: oklch(62% 0.2 186 / 0.09); }\n.sess-item.active { border-left-color: transparent; background: oklch(62% 0.2 186 / 0.14); box-shadow: inset 0 0 0 1px oklch(62% 0.2 186 / 0.32); }\n.sess-item.running { border-left-color: #28c068; }\n.sess-ts { font-size: 10px; color: oklch(42% 0.05 186); margin-bottom: 3px; }\n.sess-prompt {\n  font-size: 12px; color: oklch(70% 0.05 186); line-height: 1.4;\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 188px;\n}\n.sess-badges { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }\n.sess-project { font-size: 7px; color: oklch(40% 0.1 186); letter-spacing: 1px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.sess-badge {\n  font-size: 8px; padding: 2px 6px; border-radius: 3px;\n  border: 1px solid oklch(62% 0.2 186 / 0.25); color: oklch(62% 0.09 186);\n  background: oklch(62% 0.2 186 / 0.08);\n}\n.sess-badge.running-badge { border-color: rgba(40,192,104,0.4); color: #28c068; background: rgba(40,192,104,0.08); }\n#git-user-row {\n  display: flex; align-items: center; gap: 5px;\n  margin-top: 7px; padding-top: 6px;\n  border-top: 1px solid oklch(62% 0.2 186 / 0.12);\n}\n#git-user-icon { font-size: 9px; color: #3a3a70; }\n#git-user-name {\n  font-size: 9px; letter-spacing: 0.5px; color: #4a4a90;\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n}\n#git-cwd-row {\n  display: flex; align-items: center; gap: 5px; margin-top: 4px;\n}\n#git-cwd-icon { font-size: 9px; color: #2a2a58; }\n#git-cwd-name {\n  font-size: 9px; letter-spacing: 0.3px; color: #38386a;\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n  direction: rtl; text-align: left;\n}\n.sess-trace-link {\n  font-size: 7px; color: #3a3a70; text-decoration: none; letter-spacing: 0.5px;\n  padding: 1px 5px; border: 1px solid oklch(62% 0.2 186 / 0.2); border-radius: 3px;\n  margin-left: auto; flex-shrink: 0;\n}\n.sess-trace-link:hover { color: oklch(66% 0.11 186); border-color: oklch(62% 0.2 186 / 0.5); }\n.dp-export-btn {\n  font-size: 9px; font-family: inherit; color: oklch(58% 0.09 186); text-decoration: none;\n  padding: 4px 8px; border: 1px solid oklch(62% 0.2 186 / 0.25); border-radius: 4px;\n  background: oklch(62% 0.2 186 / 0.07); cursor: pointer; letter-spacing: 0.3px;\n}\n.dp-export-btn:hover { color: oklch(72% 0.12 186); border-color: oklch(62% 0.2 186 / 0.5); background: oklch(62% 0.2 186 / 0.15); }\n#sb-no-sessions {\n  padding: 20px 14px; font-size: 9px; color: oklch(42% 0.06 186); line-height: 1.7;\n  text-align: center;\n}\n#sb-movie-btn {\n  margin: 10px 14px;\n  background: oklch(62% 0.2 186 / 0.12);\n  border: 1px solid oklch(62% 0.2 186 / 0.35);\n  color: oklch(56% 0.16 186); font-size: 9px; letter-spacing: 2px;\n  border-radius: 6px; padding: 7px; cursor: pointer; width: calc(100% - 28px);\n  transition: background 0.15s, color 0.15s;\n  font-family: 'Azeret Mono', 'Space Mono', 'Courier New', monospace;\n}\n#sb-movie-btn:hover { background: oklch(62% 0.2 186 / 0.25); color: #d0b0ff; }\n#sb-movie-btn.active { background: oklch(62% 0.2 186 / 0.25); color: #d0b0ff; border-color: oklch(62% 0.2 186 / 0.6); }\n\n/* ── SVG title overlay ── */\n#title-wrap {\n  position: absolute; top: 16px; left: 50%; transform: translateX(-50%);\n  text-align: center; pointer-events: none; z-index: 5;\n}\n#title-h1 {\n  font-size: 22px; font-weight: 900; letter-spacing: 0.38em;\n  color: oklch(84% 0.14 186);\n}\n#title-sub { font-size: 9px; color: oklch(38% 0.06 186); letter-spacing: 3px; margin-top: 6px; }\n\n/* ── Prompt box ── */\n#prompt-box {\n  position: absolute; bottom: 76px; left: 50%; transform: translateX(-50%);\n  min-width: 340px; max-width: 500px;\n  background: rgba(6,4,22,0.96);\n  border: 1px solid rgba(130,80,255,0.5);\n  border-radius: 12px; padding: 10px 18px;\n  z-index: 50; opacity: 0;\n  box-shadow: 0 4px 28px rgba(100,50,255,0.16);\n  backdrop-filter: blur(18px);\n}\n#p-tag { font-size: 8px; letter-spacing: 3px; color: #48489a; margin-bottom: 4px; }\n#p-line { font-size: 12.5px; color: #90c8ff; display: flex; align-items: center; gap: 2px; min-height: 19px; }\n#p-cursor {\n  display: inline-block; width: 2px; height: 14px;\n  background: #90c8ff; flex-shrink: 0;\n  animation: blink 0.8s step-end infinite;\n}\n@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }\n\n/* ── Activity log ── */\n#activity-log {\n  position: absolute; left: 10px; bottom: 76px;\n  width: 240px;\n  background: rgba(5,3,18,0.93);\n  border: 1px solid rgba(70,45,165,0.35);\n  border-radius: 10px; padding: 9px 12px;\n  z-index: 50; opacity: 0;\n}\n#log-title { font-size: 7.5px; letter-spacing: 3px; color: #282870; margin-bottom: 6px;\n  padding-bottom: 5px; border-bottom: 1px solid rgba(70,45,165,0.18); }\n#log-entries { font-size: 9px; line-height: 1.95; max-height: 160px; overflow: hidden; }\n.log-row { display: flex; gap: 5px; opacity: 0; }\n.log-tag { font-weight: bold; min-width: 58px; flex-shrink: 0; }\n.log-msg { color: #525298; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }\n\n/* ── Mode banner ── */\n#mode-banner {\n  position: absolute; top: 14px; right: 10px;\n  font-size: 8px; letter-spacing: 3px; color: #303070;\n  z-index: 5; pointer-events: none;\n}\n#mode-banner.live-mode { color: #28c068; }\n\n/* ── Control bar ── */\n#ctrl {\n  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);\n  display: flex; align-items: center; gap: 7px;\n  background: rgba(8,6,26,0.95);\n  border: 1px solid rgba(100,60,220,0.35);\n  border-radius: 26px; padding: 6px 16px;\n  z-index: 100; backdrop-filter: blur(18px);\n  opacity: 0;\n}\n.c-btn {\n  background: none; border: 1px solid rgba(100,60,220,0.4);\n  color: #7858d0; width: 26px; height: 26px; border-radius: 50%;\n  cursor: pointer; font-size: 10px;\n  display: flex; align-items: center; justify-content: center;\n  transition: background 0.12s, color 0.12s; flex-shrink: 0; line-height: 1;\n}\n.c-btn:hover { background: rgba(100,60,220,0.2); color: #d0b0ff; }\n.c-btn.disabled { opacity: 0.3; pointer-events: none; }\n#scrubber {\n  width: 180px; height: 3px; cursor: pointer;\n  -webkit-appearance: none; appearance: none;\n  background: rgba(100,60,220,0.2); border-radius: 2px; outline: none;\n}\n#scrubber::-webkit-slider-thumb {\n  -webkit-appearance: none; width: 11px; height: 11px;\n  border-radius: 50%; background: #7858d0; cursor: pointer; border: none;\n}\n#t-disp { font-size: 9px; color: #484888; min-width: 36px; text-align: right; font-variant-numeric: tabular-nums; }\n#spd {\n  background: rgba(8,6,26,0.85); border: 1px solid rgba(100,60,220,0.3);\n  color: oklch(55% 0.12 186); font-size: 9px; font-family: 'Azeret Mono', 'Space Mono', monospace;\n  border-radius: 4px; padding: 2px 4px; cursor: pointer; outline: none;\n}\n#spd option { background: #0d0a20; }\n\n/* ── Detail panel ── */\n#dp-header {\n  padding: 14px 16px 10px;\n  border-bottom: 1px solid oklch(62% 0.2 186 / 0.18); flex-shrink: 0;\n}\n#dp-close {\n  float: right; background: none; border: none; color: #404070;\n  cursor: pointer; font-size: 13px; padding: 0; line-height: 1;\n}\n#dp-close:hover { color: #a090e0; }\n#dp-title { font-size: 9px; letter-spacing: 3px; color: #5050a0; margin-top: 2px; }\n#dp-emoji { font-size: 22px; display: block; margin-bottom: 4px; }\n#dp-body { flex: 1; overflow-y: auto; padding: 12px 16px; scrollbar-width: thin; scrollbar-color: oklch(62% 0.2 186 / 0.3) transparent; }\n#dp-body::-webkit-scrollbar { width: 4px; }\n#dp-body::-webkit-scrollbar-thumb { background: oklch(62% 0.2 186 / 0.3); border-radius: 2px; }\n.dp-section { margin-bottom: 14px; }\n.dp-section-title { font-size: 7.5px; letter-spacing: 3px; color: oklch(38% 0.07 186); margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid oklch(62% 0.2 186 / 0.15); }\n.dp-event { font-size: 9px; line-height: 1.6; color: #5060a0; margin-bottom: 4px; }\n.dp-event .ev-ts { color: #282855; }\n.dp-event .ev-type { color: inherit; font-weight: bold; }\n.dp-artifact { font-size: 9px; color: #6070a0; padding: 3px 6px; background: oklch(62% 0.2 186 / 0.08); border-radius: 3px; margin-bottom: 3px; }\n.dp-agent { display: inline-block; font-size: 8px; padding: 2px 7px; border-radius: 10px; margin: 2px 3px 2px 0; border: 1px solid oklch(62% 0.2 186 / 0.3); color: oklch(55% 0.09 186); }\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n</style>\n</head>\n<body>\n<div id=\"app\">\n  <!-- ── Left sidebar: session history ── -->\n  <div id=\"sidebar\">\n    <div id=\"sb-header\">\n      <div id=\"sb-title\">SESSIONS</div>\n      <select id=\"proj-filter\" onchange=\"applyProjectFilter(this.value)\" style=\"width:100%;margin-top:6px;background:oklch(12% 0.015 186);color:oklch(52% 0.1 186);border:1px solid oklch(62% 0.2 186 / 0.18);border-radius:3px;font-size:8px;letter-spacing:1px;padding:3px 4px;cursor:pointer\"><option value=\"\">ALL PROJECTS</option></select>\n      <div class=\"live-row\">\n        <div class=\"l-dot\" id=\"l-dot\"></div>\n        <span id=\"l-status\">OFFLINE</span>\n        <span id=\"l-agents\">0 agents</span>\n      </div>\n      <div id=\"git-user-row\">\n        <span id=\"git-user-icon\">⬡</span>\n        <span id=\"git-user-name\">—</span>\n      </div>\n      <div id=\"git-cwd-row\">\n        <span id=\"git-cwd-icon\">◎</span>\n        <span id=\"git-cwd-name\">—</span>\n      </div>\n    </div>\n    <div id=\"sb-sessions\">\n      <div id=\"sb-no-sessions\">No sessions yet.<br><br>Describe a goal and<br>Mastermind routes it<br>across specialist agents.<br><br><span style=\"color:oklch(56% 0.16 186);letter-spacing:1px\">/mastermind</span></div>\n    </div>\n    <button id=\"sb-movie-btn\" onclick=\"toggleMovieMode(currentSessionObj)\">▶ MOVIE MODE</button>\n  </div>\n\n  <!-- ── Stage ── -->\n  <div id=\"stage-wrap\">\n    <!-- SVG -->\n    <svg id=\"stage\" viewBox=\"0 0 960 720\" preserveAspectRatio=\"xMidYMid meet\">\n      <defs>\n        <filter id=\"glow\" x=\"-55%\" y=\"-55%\" width=\"210%\" height=\"210%\">\n          <feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"5\" result=\"b\"/>\n          <feMerge><feMergeNode in=\"b\"/><feMergeNode in=\"SourceGraphic\"/></feMerge>\n        </filter>\n        <filter id=\"bloom\" x=\"-100%\" y=\"-100%\" width=\"300%\" height=\"300%\">\n          <feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"15\" result=\"b\"/>\n          <feMerge><feMergeNode in=\"b\"/><feMergeNode in=\"SourceGraphic\"/></feMerge>\n        </filter>\n      </defs>\n      <rect width=\"960\" height=\"720\" fill=\"#07071a\"/>\n      <g id=\"stars\"></g>\n      <g id=\"net-edges\"></g>\n      <g id=\"net-particles\"></g>\n      <g id=\"net-nodes\"></g>\n    </svg>\n\n    <!-- Overlays -->\n    <div id=\"title-wrap\">\n      <div id=\"title-h1\">MASTERMIND</div>\n      <div id=\"title-sub\">AUTONOMOUS EXECUTION · 12 DOMAINS · PERSISTENT ORGS</div>\n    </div>\n\n    <div id=\"mode-banner\">LIVE</div>\n\n    <div id=\"prompt-box\">\n      <div id=\"p-tag\">USER PROMPT</div>\n      <div id=\"p-line\"><span id=\"p-text\"></span><span id=\"p-cursor\"></span></div>\n    </div>\n\n    <div id=\"activity-log\">\n      <div id=\"log-title\">ACTIVITY LOG</div>\n      <div id=\"log-entries\"></div>\n    </div>\n\n    <div id=\"ctrl\">\n      <button class=\"c-btn disabled\" id=\"btn-restart\" title=\"Restart\">↺</button>\n      <button class=\"c-btn disabled\" id=\"btn-play\" title=\"Play\">▶</button>\n      <button class=\"c-btn disabled\" id=\"btn-pause\" title=\"Pause\">⏸</button>\n      <input type=\"range\" id=\"scrubber\" min=\"0\" max=\"100\" value=\"0\" step=\"0.1\" disabled/>\n      <span id=\"t-disp\">—</span>\n      <select id=\"spd\">\n        <option value=\"0.5\">0.5×</option>\n        <option value=\"1\" selected>1×</option>\n        <option value=\"2\">2×</option>\n        <option value=\"3\">3×</option>\n      </select>\n    </div>\n  </div>\n\n  <!-- ── Right panel: session/domain detail ── -->\n  <div id=\"detail-panel\">\n    <div id=\"dp-header\">\n      <button id=\"dp-close\" onclick=\"closeDetail()\">✕</button>\n      <span id=\"dp-emoji\"></span>\n      <div id=\"dp-title\">SELECT A DOMAIN OR SESSION</div>\n    </div>\n    <div id=\"dp-body\"></div>\n  </div>\n</div>\n\n<script src=\"https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js\"></script>\n<script>\n'use strict';\n\n// ── Graph constants ──────────────────────────────────────────────────────────\nconst CX = 480, CY = 360;\nconst DOMAIN_COLORS = {\n  build:'#60a5fa', idea:'#fbbf24', marketing:'#f472b6', review:'#34d399',\n  research:'#a78bfa', content:'#fb923c', release:'#22d3ee', sales:'#f87171',\n  ops:'#4ade80', finance:'#fde68a', orgs:'#c084fc', default:'#00E5C8'\n};\nconst DOMAIN_EMOJIS = {\n  build:'⚙️', idea:'💡', marketing:'📣', review:'🔍', research:'🔬',\n  content:'✍️', release:'🚀', sales:'💼', ops:'⚡', finance:'💰', orgs:'🏛'\n};\nconst AGENT_EMOJIS = {\n  'coder':'⚙', 'architect':'🏗', 'tester':'🧪', 'reviewer':'🔍',\n  'researcher':'🔬', 'frontend-dev':'🎨', 'backend-dev':'⚡',\n  'coordinator':'🎯', 'planner':'📋', 'general-purpose':'🤖',\n  'frontend':'🎨', 'backend':'⚡', 'ml-developer':'🧠',\n  'security-architect':'🔒', 'sparc-coder':'💻', 'default':'◈'\n};\n\n// ── Node/edge model ───────────────────────────────────────────────────────────\nconst nodes = new Map();\nconst edges  = [];\nlet   rootId = null;\nlet   simActive = false;\n\n// ── SVG helpers ───────────────────────────────────────────────────────────────\nconst NS  = 'http://www.w3.org/2000/svg';\nconst mkN = (tag, a) => {\n  const el = document.createElementNS(NS, tag);\n  if (a) for (const [k,v] of Object.entries(a)) el.setAttribute(k, v);\n  return el;\n};\nconst starsG    = document.getElementById('stars');\nconst edgesG    = document.getElementById('net-edges');\nconst particlesG= document.getElementById('net-particles');\nconst nodesG    = document.getElementById('net-nodes');\n\n// ── Star field ────────────────────────────────────────────────────────────────\n(function buildStars() {\n  for (let i = 0; i < 170; i++) {\n    starsG.appendChild(mkN('circle', {\n      cx: (Math.random()*960).toFixed(1),\n      cy: (Math.random()*720).toFixed(1),\n      r:  (Math.random()<0.1 ? Math.random()*1.5+0.8 : Math.random()*0.8+0.15).toFixed(2),\n      fill: `rgba(160,150,255,${(Math.random()*0.35+0.08).toFixed(2)})`\n    }));\n  }\n  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {\n    gsap.to([...starsG.children], {\n      opacity: 'random(0.06,0.6)', duration: 'random(2,5)',\n      stagger:{ amount:16, from:'random', repeat:-1, yoyo:true, ease:'sine.inOut' }, delay:1\n    });\n  }\n})();\n\n// ── Hex helper ────────────────────────────────────────────────────────────────\nfunction hexPts(r) {\n  return Array.from({length:6},(_,i)=>{\n    const a=i*Math.PI/3-Math.PI/6;\n    return `${(r*Math.cos(a)).toFixed(1)},${(r*Math.sin(a)).toFixed(1)}`;\n  }).join(' ');\n}\n\n// ── Force simulation (Verlet) ─────────────────────────────────────────────────\nconst SPRING_K  = 0.030;\nconst REPULSION = 6000;\nconst DAMPING   = 0.78;\nconst REST_DIST = { root:0, domain:185, agent:68, org:160 };\n\nfunction forceStep() {\n  const arr = [...nodes.values()];\n  for (const n of arr) { n.ax=0; n.ay=0; }\n  for (let i=0; i<arr.length; i++) {\n    for (let j=i+1; j<arr.length; j++) {\n      const a=arr[i], b=arr[j];\n      const dx=b.x-a.x, dy=b.y-a.y;\n      const d2=dx*dx+dy*dy+1, d=Math.sqrt(d2);\n      const f=REPULSION/(d2*d);\n      if (!a.fixed){a.ax-=dx*f; a.ay-=dy*f;}\n      if (!b.fixed){b.ax+=dx*f; b.ay+=dy*f;}\n    }\n  }\n  for (const e of edges) {\n    const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n    if (!a||!b) continue;\n    const dx=b.x-a.x, dy=b.y-a.y;\n    const d=Math.sqrt(dx*dx+dy*dy)+0.001;\n    const rest=REST_DIST[b.type]??110;\n    const f=(d-rest)*SPRING_K;\n    if (!a.fixed){a.ax+=dx/d*f; a.ay+=dy/d*f;}\n    if (!b.fixed){b.ax-=dx/d*f; b.ay-=dy/d*f;}\n  }\n  for (const n of arr) {\n    if (n.fixed) continue;\n    n.vx=(n.vx+n.ax)*DAMPING;\n    n.vy=(n.vy+n.ay)*DAMPING;\n    n.x=Math.max(60,Math.min(900,n.x+n.vx));\n    n.y=Math.max(60,Math.min(660,n.y+n.vy));\n  }\n}\n\n// ── Node renderer ─────────────────────────────────────────────────────────────\nfunction buildNodeEl(n) {\n  const g=mkN('g',{transform:`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`});\n  g.style.opacity='0'; g.style.cursor='pointer';\n  if (n.type==='root') {\n    g.appendChild(mkN('circle',{r:'58',fill:'none',stroke:n.color,'stroke-width':'0.5',opacity:'0.15'}));\n    g.appendChild(mkN('circle',{r:'38',fill:'#070620',stroke:n.color,'stroke-width':'2.8',filter:'url(#glow)'}));\n    g.appendChild(mkN('circle',{r:'30',fill:'none',stroke:n.color,'stroke-width':'0.8',opacity:'0.35'}));\n    const hex=mkN('polygon',{points:hexPts(16),fill:'none',stroke:n.color,'stroke-width':'1.8',opacity:'0.75'});\n    g.appendChild(hex);\n    gsap.to(hex,{rotate:360,transformOrigin:'0 0',duration:24,repeat:-1,ease:'none'});\n    const lbl=mkN('text',{x:'0',y:'58','text-anchor':'middle','font-size':'6.5',fill:n.color,'letter-spacing':'2',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent='MASTERMIND'; g.appendChild(lbl);\n  } else if (n.type==='domain') {\n    g.appendChild(mkN('circle',{r:'44',fill:'none',stroke:n.color,'stroke-width':'0.5',opacity:'0.2'}));\n    g.appendChild(mkN('circle',{r:'30',fill:'#09071e',stroke:n.color,'stroke-width':'2.5',filter:'url(#glow)'}));\n    const emj=mkN('text',{x:'0',y:'9','text-anchor':'middle','font-size':'17'});\n    emj.textContent=n.emoji||'◈'; g.appendChild(emj);\n    const lbl=mkN('text',{x:'0',y:'45','text-anchor':'middle','font-size':'7',fill:n.color,'letter-spacing':'1.5',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent=n.label; g.appendChild(lbl);\n    const ring=mkN('circle',{r:'34',fill:'none',stroke:'#fbbf24','stroke-width':'2',opacity:'0',\n      transform:'rotate(-90)','stroke-dasharray':'213.6','stroke-dashoffset':'213.6','stroke-linecap':'round'});\n    ring.dataset.cring=n.id;\n    g.appendChild(ring);\n  } else if (n.type==='agent') {\n    g.appendChild(mkN('circle',{r:'20',fill:'#08061a',stroke:n.color,'stroke-width':'1.8',filter:'url(#glow)'}));\n    const emj=mkN('text',{x:'0',y:'5','text-anchor':'middle','font-size':'12'});\n    emj.textContent=n.emoji||'◈'; g.appendChild(emj);\n    const sl=n.label.length>11?n.label.slice(0,10)+'…':n.label;\n    const lbl=mkN('text',{x:'0',y:'31','text-anchor':'middle','font-size':'6',fill:n.color,'letter-spacing':'0.6',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent=sl; g.appendChild(lbl);\n  } else if (n.type==='org') {\n    g.appendChild(mkN('polygon',{points:'0,-38 32,0 0,38 -32,0',fill:'#09071e',stroke:n.color,'stroke-width':'2.5',filter:'url(#glow)'}));\n    const emj=mkN('text',{x:'0',y:'7','text-anchor':'middle','font-size':'16'});\n    emj.textContent='🏛'; g.appendChild(emj);\n    const lbl=mkN('text',{x:'0',y:'53','text-anchor':'middle','font-size':'6.5',fill:n.color,'letter-spacing':'1.5',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent=n.label; g.appendChild(lbl);\n  }\n  g.appendChild(mkN('circle',{r:n.type==='agent'?'22':'50',fill:'transparent'}));\n  nodesG.appendChild(g);\n  n.el=g;\n  gsap.to(g,{opacity:1,duration:0.4,ease:'power2.out'});\n  gsap.from(g,{scale:0.15,transformOrigin:'0 0',duration:0.55,ease:'back.out(1.7)'});\n}\n\n// ── Edge renderer ─────────────────────────────────────────────────────────────\nfunction buildEdgeEl(e) {\n  const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n  if (!a||!b) return;\n  const g=mkN('g'); g.style.opacity='0';\n  const isIC=e.type==='intercom';\n  const path=mkN('path',{fill:'none',stroke:a.color,opacity:isIC?'0.75':'0.4',\n    'stroke-width':isIC?'1.5':'0.9','stroke-dasharray':isIC?'5 3':'none'});\n  g.appendChild(path);\n  if (isIC&&e.msg) {\n    const txt=mkN('text',{'font-size':'6.5',fill:a.color,\n      'font-family':\"'Azeret Mono','Space Mono',monospace\",'letter-spacing':'0.4',opacity:'0.8'});\n    txt.textContent=e.msg.length>24?e.msg.slice(0,23)+'…':e.msg;\n    g.appendChild(txt); e.msgEl=txt;\n  }\n  edgesG.insertBefore(g,edgesG.firstChild);\n  e.el=g; e.pathEl=path;\n  gsap.to(g,{opacity:1,duration:0.6,delay:0.12});\n  updateEdge(e);\n}\n\nfunction updateEdge(e) {\n  const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n  if (!a||!b||!e.pathEl) return;\n  if (e.type==='intercom') {\n    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2-65;\n    e.pathEl.setAttribute('d',`M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`);\n    if (e.msgEl){e.msgEl.setAttribute('x',(mx-22).toFixed(1));e.msgEl.setAttribute('y',(my-9).toFixed(1));}\n  } else {\n    e.pathEl.setAttribute('d',`M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`);\n  }\n}\n\n// ── Particle system ───────────────────────────────────────────────────────────\nconst PPC = 7;\nfunction spawnParticles(e) {\n  const col=(nodes.get(e.fromId)||{color:'#00E5C8'}).color;\n  e.ptcls=Array.from({length:PPC},(_,i)=>{\n    const dot=mkN('circle',{r:'2',fill:col,opacity:'0'});\n    particlesG.appendChild(dot);\n    return {el:dot, t:i/PPC};\n  });\n}\nfunction tickParticles() {\n  for (const e of edges) {\n    if (!e.ptcls) continue;\n    const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n    if (!a||!b) continue;\n    for (const p of e.ptcls) {\n      p.t=(p.t+0.0045)%1;\n      const t=p.t;\n      let px,py;\n      if (e.type==='intercom') {\n        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2-65;\n        px=(1-t)*(1-t)*a.x+2*(1-t)*t*mx+t*t*b.x;\n        py=(1-t)*(1-t)*a.y+2*(1-t)*t*my+t*t*b.y;\n      } else {\n        px=a.x+(b.x-a.x)*t; py=a.y+(b.y-a.y)*t;\n      }\n      p.el.setAttribute('cx',px.toFixed(1));\n      p.el.setAttribute('cy',py.toFixed(1));\n      p.el.setAttribute('opacity',(Math.sin(t*Math.PI)*0.85).toFixed(2));\n    }\n  }\n}\n\n// ── RAF render loop ───────────────────────────────────────────────────────────\nlet rafLast=0;\nfunction rafLoop(ts) {\n  if (ts-rafLast>=16) {\n    if (simActive) forceStep();\n    for (const n of nodes.values()) {\n      if (n.el) n.el.setAttribute('transform',`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);\n    }\n    for (const e of edges) updateEdge(e);\n    tickParticles();\n    rafLast=ts;\n  }\n  requestAnimationFrame(rafLoop);\n}\nrequestAnimationFrame(rafLoop);\n\n// ── Graph mutation API ────────────────────────────────────────────────────────\nfunction gAddNode({id,type,domain,agentSlug,label,emoji,color,parentId,cmd}) {\n  if (nodes.has(id)) return nodes.get(id);\n  const par=parentId?nodes.get(parentId):null;\n  const px=par?par.x:CX, py=par?par.y:CY;\n  const ang=Math.random()*Math.PI*2;\n  const dist={root:0,domain:175,agent:75,org:155}[type]??120;\n  const n={\n    id,type,domain,agentSlug,\n    label:label||id,\n    emoji:emoji||(agentSlug?(AGENT_EMOJIS[agentSlug]||AGENT_EMOJIS.default):'◈'),\n    color:color||(domain?(DOMAIN_COLORS[domain]||DOMAIN_COLORS.default):DOMAIN_COLORS.default),\n    x:type==='root'?CX:px+Math.cos(ang)*dist+(Math.random()-.5)*28,\n    y:type==='root'?CY:py+Math.sin(ang)*dist+(Math.random()-.5)*28,\n    vx:0,vy:0,ax:0,ay:0,\n    fixed:type==='root',\n    parentId:parentId||null,\n    cmd:cmd||null,\n    done:false,\n    state:'active',ts:Date.now()\n  };\n  nodes.set(id,n);\n  simActive=nodes.size>1;\n  buildNodeEl(n);\n  return n;\n}\nfunction gAddEdge({id,fromId,toId,type,msg}) {\n  const eid=id||`${fromId}→${toId}`;\n  if (edges.find(e=>e.id===eid)) return;\n  const e={id:eid,fromId,toId,type:type||'activation',msg};\n  edges.push(e);\n  buildEdgeEl(e);\n  spawnParticles(e);\n}\nfunction gComplete(id) {\n  const cn = nodes.get(id); if (cn) cn.done = true;\n  const n=nodes.get(id);\n  if (!n||!n.el) return;\n  n.state='complete';\n  const circ=n.el.querySelector('circle[r=\"30\"]')||n.el.querySelector('circle');\n  if (circ) gsap.to(circ,{attr:{stroke:'#fbbf24'},duration:0.3,yoyo:true,repeat:2,\n    onComplete:()=>gsap.to(n.el,{opacity:0.65,duration:1.5})});\n  const ring=n.el.querySelector('[data-cring]');\n  if (ring) gsap.to(ring,{opacity:1,'stroke-dashoffset':0,duration:1.6,ease:'power1.inOut'});\n}\nfunction gClear() {\n  nodes.clear(); edges.length=0; rootId=null; simActive=false;\n  nodesG.innerHTML=''; edgesG.innerHTML=''; particlesG.innerHTML='';\n}\nfunction pulseRoot() {\n  const n=nodes.get(rootId);\n  if (!n||!n.el) return;\n  const c=n.el.querySelector('circle[r=\"38\"]');\n  if (c) gsap.to(c,{attr:{'stroke-width':6},duration:0.25,yoyo:true,repeat:1});\n}\n\n// ── Activity log ──────────────────────────────────────────────────────────────\nfunction addLog(tag,msg,color) {\n  const wrap=document.getElementById('log-entries');\n  const row=document.createElement('div');\n  row.className='log-row';\n  row.innerHTML=`<span class=\"log-tag\" style=\"color:${color}\">${tag}</span><span class=\"log-msg\">${msg}</span>`;\n  wrap.appendChild(row);\n  gsap.fromTo(row,{opacity:0},{opacity:1,duration:0.3});\n  const rows=wrap.querySelectorAll('.log-row');\n  if (rows.length>10) gsap.to(rows[0],{opacity:0,height:0,duration:0.22,onComplete:()=>rows[0].remove()});\n}\n\n// ── Movie mode ────────────────────────────────────────────────────────────────\nlet isMovieMode=false;\nlet movieTl=null;\n\nfunction buildMovieTl(sessionData) {\n  gClear();\n  document.getElementById('log-entries').innerHTML='';\n  document.getElementById('p-text').textContent='';\n  const evts=[...(sessionData&&sessionData.events?sessionData.events:[])].sort((a,b)=>(a.ts||0)-(b.ts||0));\n  const tl=gsap.timeline({paused:true,defaults:{ease:'power2.out'}});\n  if (!evts.length) {\n    tl.add(()=>addLog('[DEMO]','Select a session from the sidebar','#00E5C8'),0.2);\n    return tl;\n  }\n  evts.forEach((ev,i)=>{\n    const ev2=Object.assign({},ev);\n    tl.add(()=>handleGraphEvent(ev2), 0.3+i*0.75);\n  });\n  tl.duration(0.3+evts.length*0.75+1.5);\n  return tl;\n}\n\nfunction toggleMovieMode(sessionData) {\n  isMovieMode=!isMovieMode;\n  const btn=document.getElementById('sb-movie-btn');\n  const banner=document.getElementById('mode-banner');\n  const scrubEl=document.getElementById('scrubber');\n  const tDisp=document.getElementById('t-disp');\n  if (isMovieMode) {\n    btn.classList.add('active'); btn.textContent='■ EXIT MOVIE';\n    banner.textContent='MOVIE'; banner.classList.remove('live-mode');\n    ['btn-restart','btn-play','btn-pause'].forEach(id=>document.getElementById(id).classList.remove('disabled'));\n    scrubEl.disabled=false;\n    if (movieTl) movieTl.kill();\n    movieTl=buildMovieTl(sessionData);\n    document.getElementById('btn-play').onclick=()=>movieTl.resume();\n    document.getElementById('btn-pause').onclick=()=>movieTl.pause();\n    document.getElementById('btn-restart').onclick=()=>{\n      gClear(); document.getElementById('log-entries').innerHTML='';\n      movieTl=buildMovieTl(sessionData); movieTl.play();\n    };\n    document.getElementById('spd').onchange=e=>movieTl&&movieTl.timeScale(Number(e.target.value));\n    let scrubbing=false;\n    scrubEl.addEventListener('mousedown',()=>{scrubbing=true;movieTl&&movieTl.pause();});\n    scrubEl.addEventListener('mouseup',()=>{scrubbing=false;});\n    scrubEl.addEventListener('input',()=>{if(movieTl)movieTl.progress(Number(scrubEl.value)/100);tDisp.textContent=(movieTl?movieTl.time():0).toFixed(1)+'s';});\n    gsap.ticker.add(()=>{\n      if (!scrubbing&&movieTl&&movieTl.totalDuration()>0) {\n        scrubEl.value=movieTl.progress()*100;\n        tDisp.textContent=movieTl.time().toFixed(1)+'s';\n      }\n    });\n    gsap.to('#ctrl',{opacity:1,duration:0.35});\n    movieTl.play();\n  } else {\n    btn.classList.remove('active'); btn.textContent='▶ MOVIE MODE';\n    banner.textContent='LIVE'; banner.classList.add('live-mode');\n    ['btn-restart','btn-play','btn-pause'].forEach(id=>document.getElementById(id).classList.add('disabled'));\n    scrubEl.disabled=true; tDisp.textContent='—';\n    if (movieTl){movieTl.kill();movieTl=null;}\n    gsap.to('#ctrl',{opacity:0,duration:0.25});\n  }\n}\n\n// ── Core event dispatcher ─────────────────────────────────────────────────────\nfunction handleGraphEvent(ev) {\n  const {type,session,domain,agent,from,to,msg,cmd,prompt,status} = ev;\n  if (type==='session:start') {\n    gClear(); rootId=session;\n    gAddNode({id:session,type:'root',label:'MASTERMIND',color:DOMAIN_COLORS.default});\n    if (prompt) {\n      document.getElementById('p-tag').textContent='RUNNING';\n      document.getElementById('p-text').textContent=prompt;\n      gsap.to('#prompt-box',{opacity:1,duration:0.4});\n    }\n    gsap.to('#activity-log',{opacity:1,duration:0.4,delay:0.2});\n    gsap.to('#ctrl',{opacity:1,duration:0.4,delay:0.4});\n    addLog('[SESSION]',(prompt||session).slice(0,32),'#00E5C8');\n    refreshSessions();\n  } else if (type==='domain:dispatch') {\n    if (!domain||!rootId) return;\n    const domId=`${session}:${domain}`;\n    gAddNode({id:domId,type:'domain',domain,parentId:rootId,cmd:cmd||null,\n      label:domain.toUpperCase(),emoji:DOMAIN_EMOJIS[domain]||'◈'});\n    gAddEdge({fromId:rootId,toId:domId,type:'activation'});\n    pulseRoot();\n    addLog(`[${domain.toUpperCase()}]`,cmd||domain,DOMAIN_COLORS[domain]||'#00E5C8');\n  } else if (type==='agent:spawn') {\n    if (!domain||!rootId) return;\n    const domId=`${session}:${domain}`;\n    const agId=`${session}:${domain}:${agent||'agent'}:${ev._replayIdx!==undefined?ev._replayIdx:Date.now()}`;\n    gAddNode({id:agId,type:'agent',domain,agentSlug:agent,parentId:domId,\n      label:agent||'agent',emoji:AGENT_EMOJIS[agent]||AGENT_EMOJIS.default});\n    gAddEdge({fromId:domId,toId:agId,type:'spawn'});\n    addLog(`[${(agent||'agent').slice(0,9)}]`,ev.task||agent||'',DOMAIN_COLORS[domain]||'#00E5C8');\n  } else if (type==='intercom') {\n    if (!from||!to||!rootId) return;\n    gAddEdge({id:`ic-${from}-${to}-${Date.now()}`,fromId:`${session}:${from}`,\n      toId:`${session}:${to}`,type:'intercom',msg});\n    addLog('[IC]',`${from}→${to}: ${msg||''}`,'#c084fc');\n  } else if (type==='domain:complete') {\n    gComplete(`${session}:${domain}`);\n    pulseRoot();\n    addLog(`[${(domain||'').toUpperCase()}]`,`done · ${status||'✓'}`,'#34d399');\n    refreshSessions();\n  } else if (type==='session:complete') {\n    for (const n of nodes.values()) {\n      if (n.el) gsap.to(n.el,{opacity:1,duration:0.3,yoyo:true,repeat:2,ease:'power1.inOut'});\n    }\n    addLog('[✓]',`complete — ${(ev.domains||[]).length||'all'} domains`,'#34d399');\n    setTimeout(()=>gsap.to('#prompt-box',{opacity:0,duration:1}),4000);\n    refreshSessions();\n  }\n}\n\n// ── Live event handler ────────────────────────────────────────────────────────\nfunction handleLiveEvent(ev) {\n  if (isMovieMode) return;\n  handleGraphEvent(ev);\n}\n\n\n// ── Session graph replay ───────────────────────────────────────────────\nfunction replaySessionGraph(events) {\n  if (!events || !events.length) return;\n  gClear();\n  let skipRefresh = true;\n  const origRefresh = window.refreshSessions;\n  window.refreshSessions = () => {};  // suppress during replay\n  events.forEach((ev, idx) => handleGraphEvent({...ev, _replayIdx: idx}));\n  window.refreshSessions = origRefresh;\n  gsap.to('#activity-log', {opacity:1, duration:0.4});\n  gsap.to('#ctrl', {opacity:1, duration:0.4, delay:0.2});\n}\n\n// ── SSE event stream ───────────────────────────────────────────────────────────\nlet evtSource = null;\nfunction connectSSE() {\n  if (evtSource) evtSource.close();\n  evtSource = new EventSource('/api/mastermind-stream');\n  evtSource.onmessage = (e) => {\n    try {\n      const ev = JSON.parse(e.data);\n      handleLiveEvent(ev);\n    } catch (_) {}\n  };\n  evtSource.onerror = () => {\n    const dot = document.getElementById('l-dot');\n    if (dot) dot.classList.remove('on');\n    const st = document.getElementById('l-status');\n    if (st) st.textContent = 'RECONNECTING';\n    showStatusBanner('SSE disconnected — reconnecting in 4s');\n    setTimeout(connectSSE, 4000);\n  };\n}\n\n// ── Session sidebar ────────────────────────────────────────────────────────────\nlet currentSessionId = null;\n    let currentSessionObj = null;\n\nlet activeProjectFilter = '';\n\nfunction applyProjectFilter(val) {\n  activeProjectFilter = val;\n  refreshSessions();\n}\n\nasync function refreshSessions() {\n  try {\n    const url = activeProjectFilter\n      ? `/api/mastermind/sessions?project=${encodeURIComponent(activeProjectFilter)}`\n      : '/api/mastermind/sessions';\n    const res = await fetch(url);\n    const sessions = await res.json();\n    // Populate project filter options\n    const sel = document.getElementById('proj-filter');\n    if (sel) {\n      const projects = [...new Set(sessions.map(s => s.project).filter(Boolean))];\n      const current = sel.value;\n      sel.innerHTML = '<option value=\"\">ALL PROJECTS</option>' +\n        projects.map(p => {\n          const name = p.split('/').pop();\n          return `<option value=\"${p}\" ${p===current?'selected':''}>${name}</option>`;\n        }).join('');\n    }\n    renderSessions(sessions);\n  } catch (_) {}\n}\n\nfunction renderSessions(sessions) {\n  const wrap = document.getElementById('sb-sessions');\n  const noSess = document.getElementById('sb-no-sessions');\n  if (!sessions || !sessions.length) {\n    if (noSess) noSess.style.display = 'block';\n    const items = wrap.querySelectorAll('.sess-item');\n    items.forEach(i => i.remove());\n    return;\n  }\n  if (noSess) noSess.style.display = 'none';\n  // Remove old items\n  wrap.querySelectorAll('.sess-item').forEach(el => el.remove());\n  sessions.forEach(s => {\n    const item = document.createElement('div');\n    item.className = 'sess-item' + (s.status === 'running' ? ' running' : '') + (s.id === currentSessionId ? ' active' : '');\n    const ts = new Date(s.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});\n    const date = new Date(s.ts).toLocaleDateString([], {month:'short',day:'numeric'});\n    const elapsed = s.endTs ? ((s.endTs - s.ts)/1000).toFixed(0)+'s' : (s.status==='running'?'RUNNING…':'?');\n    const projName = s.project ? s.project.split('/').pop() : '';\n    item.innerHTML = `\n      ${projName ? `<div class=\"sess-project\">◈ ${projName}</div>` : ''}\n      <div class=\"sess-ts\">${date} ${ts} · ${elapsed}</div>\n      <div class=\"sess-prompt\">${s.prompt||'(no prompt)'}</div>\n      <div class=\"sess-badges\">\n        <span class=\"sess-badge ${s.status==='running'?'running-badge':''}\">${s.status||'?'}</span>\n        ${(s.domains||[]).slice(0,4).map(d=>`<span class=\"sess-badge\">${d}</span>`).join('')}\n        ${(s.domains||[]).length>4?`<span class=\"sess-badge\">+${s.domains.length-4}</span>`:''}\n        <a class=\"sess-trace-link\" href=\"/api/mastermind/session/${s.id}/trace\" target=\"_blank\" title=\"View raw trace\" onclick=\"event.stopPropagation()\">trace↗</a>\n      </div>`;\n    item.addEventListener('click', () => {\n      wrap.querySelectorAll('.sess-item').forEach(x=>x.classList.remove('active'));\n      item.classList.add('active');\n      currentSessionId = s.id;\n      currentSessionObj = s;\n      openSessionDetail(s);\n      replaySessionGraph(s.events||[]);\n    });\n    wrap.appendChild(item);\n  });\n}\n\n// ── Detail panel ───────────────────────────────────────────────────────────────\nfunction openDomainDetail(d) {\n  const panel = document.getElementById('detail-panel');\n  document.getElementById('dp-emoji').textContent = d.emoji || '◈';\n  document.getElementById('dp-title').textContent = `DOMAIN · ${d.label}`;\n  const body = document.getElementById('dp-body');\n  // Gather events from current session for this domain\n  const sessEvts = (currentSessionObj && currentSessionObj.events) ? currentSessionObj.events : [];\n  const domEvts = sessEvts.filter(e => e.domain === d.domain || e.domain === (d.label||'').toLowerCase());\n  const spawnEvts = domEvts.filter(e => e.type === 'agent:spawn');\n  const artifacts = domEvts.flatMap(e => e.artifacts || []);\n  // Also collect child agent nodes\n  const agentNodes = [];\n  nodes.forEach(n => { if (n.parentId === d.id) agentNodes.push(n); });\n  body.innerHTML = `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">DOMAIN INFO</div>\n      <div class=\"dp-event\"><span class=\"ev-type\" style=\"color:${d.color}\">${d.emoji||'◈'} ${d.label}</span></div>\n      ${d.cmd ? `<div class=\"dp-event\">Command: <span style=\"color:#7080c0\">${d.cmd}</span></div>` : ''}\n      <div class=\"dp-event\">Status: <span style=\"color:${d.done?'#40e880':'#28c068'}\">${d.done?'COMPLETE':'RUNNING'}</span></div>\n      <div class=\"dp-event\">Agents spawned: <span style=\"color:${d.color}\">${agentNodes.length}</span></div>\n    </div>\n    ${agentNodes.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">AGENTS</div>\n      ${agentNodes.map(a => `<div class=\"dp-event\"><span class=\"ev-type\" style=\"color:${a.color||d.color}\">${a.emoji||'◈'} ${a.label}</span></div>`).join('')}\n    </div>` : ''}\n    ${spawnEvts.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">TASKS</div>\n      ${spawnEvts.map(e => `<div class=\"dp-event\" style=\"color:#506080;font-size:8px;white-space:normal;word-break:break-word;line-height:1.5\">${e.agent ? '<b>'+e.agent+'</b>: ' : ''}${(e.task||'').slice(0,120)}</div>`).join('')}\n    </div>` : ''}\n    ${artifacts.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">ARTIFACTS</div>\n      ${artifacts.map(a => `<div class=\"dp-artifact\">📄 ${a}</div>`).join('')}\n    </div>` : ''}\n    ${domEvts.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">RECENT EVENTS</div>\n      ${domEvts.slice(-8).map(e => {\n        const ts = new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});\n        return `<div class=\"dp-event\"><span class=\"ev-ts\">${ts}</span> <span class=\"ev-type\" style=\"color:${d.color}\">${e.type}</span>${e.cmd?' '+e.cmd:e.agent?' '+e.agent:''}</div>`;\n      }).join('')}\n    </div>` : ''}\n  `;\n  panel.classList.add('open');\n}\n\nasync function openSessionDetail(s) {\n  const panel = document.getElementById('detail-panel');\n  document.getElementById('dp-emoji').textContent = '📋';\n  document.getElementById('dp-title').textContent = 'SESSION DETAIL';\n  const body = document.getElementById('dp-body');\n  body.innerHTML = '<div style=\"color:#303060;font-size:9px;padding:8px\">Loading…</div>';\n  panel.classList.add('open');\n  try {\n    const res = await fetch(`/api/mastermind/session/${s.id}`);\n    const full = await res.json();\n    if (!full) { body.innerHTML = '<div style=\"color:#303060;font-size:9px\">Session not found.</div>'; return; }\n    const ts = new Date(full.ts).toLocaleString();\n    const elapsed = full.endTs ? ((full.endTs - full.ts)/1000).toFixed(1)+'s' : 'running';\n    const evts = full.events || [];\n    const domainSet = full.domains || [];\n    body.innerHTML = `\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">OVERVIEW</div>\n        <div class=\"dp-event\">Started: <span style=\"color:#6060a0\">${ts}</span></div>\n        <div class=\"dp-event\">Duration: <span style=\"color:#6060a0\">${elapsed}</span></div>\n        <div class=\"dp-event\">Status: <span style=\"color:${full.status==='complete'?'#40e880':full.status==='running'?'#28c068':'#f87171'}\">${full.status||'?'}</span></div>\n        <div class=\"dp-event\">Domains: <span style=\"color:#8080c0\">${domainSet.join(', ')||'—'}</span></div>\n      </div>\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">PROMPT</div>\n        <div class=\"dp-event\" style=\"color:oklch(58% 0.09 186);word-break:break-all;white-space:normal;line-height:1.6\">${full.prompt||'—'}</div>\n      </div>\n      ${domainSet.length ? `\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">ACTIVE DOMAINS</div>\n        ${domainSet.map(did => {\n          const color = DOMAIN_COLORS[did] || '#8080c0';\n          const emoji = DOMAIN_EMOJIS[did] || '◈';\n          const label = (did||'').toUpperCase();\n          return `<div class=\"dp-event\"><span style=\"color:${color}\">${emoji} ${label}</span></div>`;\n        }).join('')}\n      </div>` : ''}\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">EVENT TIMELINE (${evts.length})</div>\n        ${evts.map(e => {\n          const et = new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});\n          const color = e.domain ? (DOMAIN_COLORS[e.domain] || '#6060a0') : '#6060a0';\n          let detail = '';\n          if (e.type === 'session:start') detail = `<span style=\"color:#5050a0;font-size:8px;word-break:break-all\">${e.prompt||''}</span>`;\n          else if (e.type === 'domain:dispatch') detail = `<span style=\"color:#5060a0;font-size:8px\">${e.cmd||''}</span>`;\n          else if (e.type === 'agent:spawn') detail = `<span style=\"color:#507090;font-size:8px\">agent: <b>${e.agent||''}</b> — ${(e.task||'').slice(0,50)}</span>`;\n          else if (e.type === 'intercom') detail = `<span style=\"color:#506070;font-size:8px\">${e.from||'?'} → ${e.to||'?'}: ${e.msg||''}</span>`;\n          else if (e.type === 'domain:complete') {\n            const arts = (e.artifacts||[]).map(a=>`<span style=\"color:#407050;font-size:7px\">📄 ${a}</span>`).join(' ');\n            detail = `<span style=\"color:#406050;font-size:8px\">status: ${e.status||'?'}</span>${arts?' '+arts:''}`;\n          }\n          else if (e.type === 'session:complete') detail = `<span style=\"color:#405080;font-size:8px\">domains: ${(e.domains||[]).join(', ')}</span>`;\n          return `<div class=\"dp-event\" style=\"flex-direction:column;align-items:flex-start;gap:1px\"><div><span class=\"ev-ts\">${et}</span> <span class=\"ev-type\" style=\"color:${color}\">${e.type}</span>${e.domain?' <span style=\"color:#404060;font-size:8px\">['+e.domain+']</span>':''}</div>${detail?'<div style=\"padding-left:4px\">'+detail+'</div>':''}</div>`;\n        }).join('')}\n      </div>\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">EXPORT</div>\n        <div style=\"display:flex;gap:6px;flex-wrap:wrap\">\n          <a class=\"dp-export-btn\" href=\"/api/mastermind/session/${full.id}/trace\" target=\"_blank\">📄 View Trace</a>\n          <button class=\"dp-export-btn\" onclick=\"downloadSession('${full.id}')\">⬇ Download JSON</button>\n        </div>\n      </div>\n    `;\n  } catch(err) {\n    body.innerHTML = `<div style=\"color:#a03030;font-size:9px\">${err.message}</div>`;\n  }\n}\n\nfunction closeDetail() {\n  document.getElementById('detail-panel').classList.remove('open');\n  currentSessionId = null;\n  document.querySelectorAll('.sess-item').forEach(x=>x.classList.remove('active'));\n}\n\nasync function downloadSession(id) {\n  const res = await fetch(`/api/mastermind/session/${id}`);\n  const data = await res.json();\n  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});\n  const a = document.createElement('a');\n  a.href = URL.createObjectURL(blob);\n  a.download = `${id}.json`;\n  a.click();\n  URL.revokeObjectURL(a.href);\n}\n\n// ── Live data polling for status bar ──────────────────────────────────────────\nasync function pollStatus() {\n  try {\n    const res = await fetch('/api/data');\n    if (!res.ok) return;\n    const data = await res.json();\n    const active = !!data?.swarm?.activity?.swarm?.active;\n    const dot = document.getElementById('l-dot');\n    dot.classList.toggle('on', active);\n    document.getElementById('l-status').textContent = active ? 'LIVE' : 'IDLE';\n    const n = data?.swarm?.state?.agentPlan?.length || 0;\n    document.getElementById('l-agents').textContent = n + ' agent' + (n!==1?'s':'');\n    // Highlight last routed domain\n    const route = data?.hooks?.lastRoute || '';\n    if (route && !isMovieMode) {\n      const hit = DOMAINS.find(d => route.toLowerCase().includes(d.id));\n      if (hit) {\n        gsap.to(`#gr-${hit.id}`, { opacity:0.85, attr:{r:52}, duration:0.35 });\n        gsap.to(`#gr-${hit.id}`, { opacity:0.2, attr:{r:44}, duration:1.8, delay:0.35 });\n      }\n    }\n  } catch (_) {}\n}\n\n\nfunction showStatusBanner(msg) {\n  let b = document.getElementById('status-banner');\n  if (!b) {\n    b = document.createElement('div'); b.id = 'status-banner';\n    b.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:5px 14px;background:oklch(24% 0.05 186);border-bottom:1px solid oklch(68% 0.18 186 / 0.35);color:oklch(70% 0.05 186);font-size:9px;letter-spacing:1.5px;text-align:center;z-index:9999;transition:opacity 0.5s;pointer-events:none;';\n    document.body.appendChild(b);\n  }\n  b.textContent = msg; b.style.opacity = '1';\n  clearTimeout(b._t); b._t = setTimeout(() => { b.style.opacity = '0'; }, 5000);\n}\n\n// ── Bootstrap ──────────────────────────────────────────────────────────────────\nconnectSSE();\nrefreshSessions();\npollStatus();\nfetch('/api/git-user').then(r=>r.json()).then(u=>{\n  if (u.name) document.getElementById('git-user-name').textContent = u.name;\n  if (u.cwd) {\n    const parts = u.cwd.replace(/\\\\/g, '/').split('/');\n    document.getElementById('git-cwd-name').textContent = parts.slice(-2).join('/');\n    document.getElementById('git-cwd-name').title = u.cwd;\n  }\n}).catch(()=>{});\nsetInterval(pollStatus, 4000);\nsetInterval(refreshSessions, 8000);\n\n// Set initial live mode banner\ndocument.getElementById('mode-banner').classList.add('live-mode');\n</script>\n</body>\n</html>\n";


// ─── Session JSONL parser ────────────────────────────────────────────────────
function categorizeTool(name) {
  if (['Read','Write','Edit','MultiEdit','Glob','Grep','LS'].includes(name)) return 'file';
  if (name === 'Bash') return 'bash';
  if (['Agent','Task'].includes(name)) return 'agent';
  if (name.startsWith('mcp__monomind__memory') || name.startsWith('mcp__monomind__agentdb')) return 'memory';
  if (['WebFetch','WebSearch'].includes(name)) return 'web';
  if (name === 'TodoWrite' || name === 'TodoRead') return 'task';
  if (name === 'Skill') return 'skill';
  if (name === 'ToolSearch') return 'search';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function parseSessionLines(lines) {
  const events = [];
  let agentDepth = 0;
  const toolMap = new Map(); // id → tool event index

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const type = entry.type;
    const ts = entry.timestamp || null;
    const uuid = entry.uuid || null;

    if (type === 'user') {
      const content = entry.message?.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content.filter(b => b && b.type === 'text').map(b => b.text).join('');
      }
      if (text && text.length > 0) {
        events.push({ kind: 'user', text: text.slice(0, 500), uuid, ts });
      }
    } else if (type === 'assistant') {
      const content = entry.message?.content || [];
      for (const block of (Array.isArray(content) ? content : [])) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'thinking') {
          events.push({ kind: 'thinking', text: (block.thinking || '').slice(0, 200), uuid, ts });
        } else if (block.type === 'text') {
          const t = (block.text || '').trim();
          if (t) events.push({ kind: 'text', text: t.slice(0, 600), uuid, ts });
        } else if (block.type === 'tool_use') {
          const cat = categorizeTool(block.name);
          const label = buildToolLabel(block.name, block.input || {});
          const idx = events.length;
          const ev = { kind: 'tool', name: block.name, cat, label, id: block.id, uuid, ts };
          if (cat === 'agent') {
            ev.subagent = block.input?.subagent_type || block.input?.description || '?';
            ev.background = !!block.input?.run_in_background;
          }
          events.push(ev);
          if (block.id) toolMap.set(block.id, idx);
        }
      }
    } else if (type === 'tool') {
      const content = entry.message?.content || [];
      for (const block of (Array.isArray(content) ? content : [])) {
        if (!block || block.type !== 'tool_result') continue;
        const resultText = Array.isArray(block.content)
          ? block.content.filter(b => b && b.type === 'text').map(b => b.text).join('').slice(0, 400)
          : String(block.content || '').slice(0, 400);
        const isError = !!block.is_error;
        const toolIdx = toolMap.get(block.tool_use_id);
        events.push({ kind: 'tool_result', tool_use_id: block.tool_use_id, text: resultText, isError, toolIdx, uuid, ts });
      }
    }
  }
  return events;
}

function buildToolLabel(name, input) {
  if (name === 'Read') return input.file_path ? `Read ${path.basename(input.file_path)}` : 'Read';
  if (name === 'Write') return input.file_path ? `Write ${path.basename(input.file_path)}` : 'Write';
  if (name === 'Edit') return input.file_path ? `Edit ${path.basename(input.file_path)}` : 'Edit';
  if (name === 'Bash') return (input.description || input.command || 'Bash').slice(0, 60);
  if (name === 'Grep') return `Grep ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Glob') return `Glob ${(input.pattern || '').slice(0, 30)}`;
  if (name === 'Agent' || name === 'Task') return `→ ${input.subagent_type || input.description || 'agent'}`;
  if (name === 'WebFetch') return `Fetch ${(input.url || '').slice(0, 50)}`;
  if (name === 'WebSearch') return `Search ${(input.query || '').slice(0, 40)}`;
  if (name === 'Skill') return `Skill: ${input.skill || '?'}`;
  if (name.startsWith('mcp__monomind__memory')) return name.replace('mcp__monomind__memory_', 'mem:');
  if (name.startsWith('mcp__')) return name.replace('mcp__monomind__', '⬡ ').replace('mcp__', '⬡ ').slice(0, 40);
  return name.slice(0, 40);
}

// ─── Section collectors (for /api/section lazy load) ────────────────────────
function buildSectionData(name, dir) {
  const d = path.resolve(dir);
  switch (name) {
    case 'sessions': return { sessions: collectSessions(d) };
    case 'swarm':    return { swarm: collectSwarm(d), swarmHistory: collectSwarmHistory(d), agents: collectAgents(d) };
    case 'agents':   return { agents: collectAgents(d) };
    case 'tokens':   return { tokens: collectTokens(d) };
    case 'hooks':    return { hooks: collectHooks(d) };
    case 'knowledge':return { knowledge: collectKnowledge(d) };
    case 'metrics':  return { metrics: collectMetrics(d) };
    case 'system':   return { system: collectSystem() };
    case 'memory': {
      const s = collectSessions(d);
      return { sessions: { palace: s.palace }, memory: collectMemory(d) };
    }
    case 'overview': return { project: collectProject(d), system: collectSystem() };
    default: return {};
  }
}

// Map file path fragment → affected section names
function pathToSections(filename) {
  if (!filename) return null;
  const f = filename.toLowerCase();
  if (f.includes('swarm'))                          return ['swarm'];
  if (f.includes('token'))                          return ['tokens'];
  if (f.includes('registry') || f.includes('registrations')) return ['agents'];
  if (f.includes('route') || f.includes('worker-dispatch'))  return ['hooks'];
  if (f.includes('chunk') || f.includes('skills')) return ['knowledge'];
  if (f.includes('memory.db') || f.includes('memory.graph') || f.includes('hnsw.index') ||
      f.includes('monovector.db') || f.includes('ranked-context') ||
      (f.includes('/memory/') && f.endsWith('.md'))) return ['memory', 'sessions'];
  if (f.includes('palace') || f.includes('drawers') || f.includes('identity')) return ['memory', 'sessions'];
  if (f.includes('ddd') || f.includes('learning') || f.includes('audit')) return ['metrics'];
  if (f.endsWith('.jsonl') || f.includes('sessions')) return ['sessions'];
  return ['sessions', 'swarm', 'agents', 'tokens', 'hooks'];
}

// SSE client registry and mastermind SSE clients are managed by sse-manager.mjs
// Active org run tracking: org -> runId (enables event routing for orgs without runId in payload)
const activeOrgRuns = new Map();
// Active session tracking: org -> {sessionId, ts} (enables linking agent events to sessions)
const activeSessionsByOrg = new Map();
// Phase 3: Per-org SSE clients for run streaming tail endpoint
const runStreamClients = new Map(); // orgName → Set<res>

// Design doc Issue 2: concurrent write safety. Since server.mjs is the sole writer
// (all hook processes POST via HTTP), in-process serialization is sufficient.
// SQLite WAL (Issue 2 Phase 1.5): run events are indexed in an in-memory sql.js database
// with WAL mode and persisted to .monomind/run-events.db every 1000ms. JSONL files are
// still written (bash lifecycle scripts write them directly), but SQLite is the query layer
// for streaming tail replay and startup gap-fill.
//
// Serializing write queue — prevents concurrent JSONL corruption (Issue 2 from design doc)
const _writeQueue = new Map(); // filePath → Promise (in-flight write)

// ── sql.js WAL run-event index (Phase 1.5) ──────────────────────────────────
let _runDb = null;           // sql.js in-memory Database
let _runDbPath = null;       // disk path for persistence
let _runDbPersistTimer = null;
let _runDbInsertStmt = null; // prepared INSERT statement

const _require = createRequire(import.meta.url);

async function _initRunDb(monoHome) {
  try {
    const initSqlJs = _require('sql.js');
    const SQL = await initSqlJs();
    _runDbPath = path.join(monoHome, '.monomind', 'run-events.db');
    fs.mkdirSync(path.dirname(_runDbPath), { recursive: true });
    let fileData;
    try { fileData = fs.readFileSync(_runDbPath); } catch (_) {}
    _runDb = fileData ? new SQL.Database(fileData) : new SQL.Database();
    _runDb.run('PRAGMA journal_mode=WAL');
    _runDb.run('PRAGMA synchronous=NORMAL');
    _runDb.run(`CREATE TABLE IF NOT EXISTS run_events (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      org   TEXT    NOT NULL,
      run_id TEXT   NOT NULL,
      type  TEXT    NOT NULL,
      raw   TEXT    NOT NULL,
      ts    INTEGER NOT NULL,
      source TEXT   DEFAULT 'http',
      UNIQUE(org, run_id, ts, type, raw)
    )`);
    _runDb.run('CREATE INDEX IF NOT EXISTS idx_re_org_id ON run_events(org, id)');
    _runDb.run('CREATE INDEX IF NOT EXISTS idx_re_ts    ON run_events(ts)');
    _runDbInsertStmt = _runDb.prepare(
      'INSERT OR IGNORE INTO run_events (org, run_id, type, raw, ts, source) VALUES (?,?,?,?,?,?)'
    );
    // Compact old events at startup: keep last 30 days
    const _cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    _runDb.run('DELETE FROM run_events WHERE ts < ?', [_cutoff]);
    _persistRunDb();
  } catch (_) {
    _runDb = null; // graceful fallback — JSONL path continues to work
  }
}

function _persistRunDb() {
  if (!_runDb || !_runDbPath) return;
  clearTimeout(_runDbPersistTimer);
  _runDbPersistTimer = setTimeout(() => {
    try { fs.writeFileSync(_runDbPath, Buffer.from(_runDb.export())); } catch (_) {}
  }, 1000);
}

function _insertRunEvent(ev, source) {
  if (!_runDb || !_runDbInsertStmt) return;
  try {
    const org = String(ev.org || '').trim();
    const runId = String(ev.runId || '').trim();
    if (!org || !runId) return;
    _runDbInsertStmt.run([org, runId, String(ev.type || ''), JSON.stringify(ev), Number(ev.ts || Date.now()), source || 'http']);
    _persistRunDb();
  } catch (_) {}
}
// ─────────────────────────────────────────────────────────────────────────────

function appendToFile(filePath, line) {
  const prev = _writeQueue.get(filePath) || Promise.resolve();
  const next = prev.then(() => {
    try { fs.appendFileSync(filePath, line); } catch (_) {}
  });
  _writeQueue.set(filePath, next);
  next.then(() => { if (_writeQueue.get(filePath) === next) _writeQueue.delete(filePath); });
  return next;
}

// Returns the shared git directory parent so run files survive branch switches and
// are shared across all worktrees. In a worktree, .git is a FILE pointing to the
// shared .git dir (e.g. /main/.git/worktrees/feat); we navigate up two levels to
// reach /main/.git, then up one more to /main/ for the monomind data root.
// Falls back to the working directory if git isn't available.
const _gitMonomindCache = new Map();
function _getGitMonomindDir(workDir) {
  if (!workDir) return null;
  if (_gitMonomindCache.has(workDir)) return _gitMonomindCache.get(workDir);
  let result = null;
  try {
    const gitEntry = path.join(workDir, '.git');
    const st = fs.statSync(gitEntry);
    if (st.isDirectory()) {
      // Regular repo: .git is a directory
      result = path.join(gitEntry, 'monomind');
    } else if (st.isFile()) {
      // Worktree: .git is a text file "gitdir: /main/.git/worktrees/name"
      const m = fs.readFileSync(gitEntry, 'utf8').trim().match(/^gitdir:\s*(.+)/);
      if (m) {
        // Resolve relative paths (gitdir can be relative to the worktree root)
        const worktreeDir = path.resolve(workDir, m[1].trim());
        // /main/.git/worktrees/name -> /main/.git -> /main/.git/monomind
        const commonGitDir = path.dirname(path.dirname(worktreeDir));
        result = path.join(commonGitDir, 'monomind');
      }
    }
  } catch {}
  if (!result) result = path.join(workDir, '.monomind'); // fallback
  _gitMonomindCache.set(workDir, result);
  return result;
}

// Returns the monomind home directory for server-level data (capture, control.json, loops).
// Priority: MONOMIND_HOME env var > walk up from cwd finding .monomind/control.json > cwd fallback
function getMonomindHome() {
  if (process.env.MONOMIND_HOME) return path.resolve(process.env.MONOMIND_HOME);
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.monomind', 'control.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
const MONOMIND_HOME = getMonomindHome();

// Resolve an org's project directory by searching across known projects.
// Returns the first project dir where {dir}/.monomind/orgs/{orgName}.json exists, or null.
function _resolveOrgProjectDir(orgName, serverRoot) {
  const dirs = new Set([serverRoot]);
  try {
    const kf = path.join(serverRoot, 'data', 'known-projects.json');
    if (fs.existsSync(kf)) JSON.parse(fs.readFileSync(kf, 'utf8')).forEach(p => dirs.add(p));
  } catch(_) {}
  for (const d of dirs) {
    if (fs.existsSync(path.join(d, '.monomind', 'orgs', `${orgName}.json`))) return d;
  }
  return null;
}

// ── Org run state helpers ────────────────────────────────────────────────
// Reads {name}-runstate.json from disk. Returns null if missing/corrupt.
function _readRunState(orgName, rootDir) {
  const projDir = _resolveOrgProjectDir(orgName, rootDir) || rootDir;
  const base = _getGitMonomindDir(projDir) || path.join(projDir, '.monomind');
  const file = path.join(base, 'orgs', `${orgName}-runstate.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// Returns the current runId from runstate (for events that omit it after restart).
function _getActiveRunId(orgName, rootDir) {
  return _readRunState(orgName, rootDir)?.runId || null;
}

// Returns all project dirs allowed for artifact reads (serverRoot + known-projects.json).
function _getAllowedArtifactDirs(serverRoot) {
  const dirs = [path.resolve(serverRoot)];
  try {
    const kf = path.join(serverRoot, 'data', 'known-projects.json');
    if (fs.existsSync(kf)) JSON.parse(fs.readFileSync(kf, 'utf8')).forEach(p => dirs.push(path.resolve(p)));
  } catch (_) {}
  return dirs;
}

// Detects a basic mime type from file extension for artifact responses.
function _detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.ts': 'text/typescript', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain',
    '.html': 'text/html', '.css': 'text/css', '.py': 'text/x-python',
    '.sh': 'text/x-shellscript', '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.toml': 'text/plain', '.env': 'text/plain', '.xml': 'text/xml' };
  return map[ext] || 'application/octet-stream';
}

// Writes runstate.json for state-changing events. Debounces lastEventAt for frequent events.
const _runstateDebouncers = new Map();
function _updateRunState(event, rootDir) {
  const orgName = String(event.org || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!orgName) return;
  const projDir = _resolveOrgProjectDir(orgName, rootDir) || rootDir;
  const base = _getGitMonomindDir(projDir) || path.join(projDir, '.monomind');
  const orgsDir = path.join(base, 'orgs');
  const file = path.join(orgsDir, `${orgName}-runstate.json`);
  const stateChanging = ['org:start','org:stop','org:agent:online','org:agent:offline'];
  const ts = event.ts || Date.now();

  if (stateChanging.includes(event.type)) {
    // State-changing: clear any pending debounced write, then write immediately
    const pending = _runstateDebouncers.get(orgName);
    if (pending?.timer) clearTimeout(pending.timer);
    _runstateDebouncers.delete(orgName);
    let cur = null;
    try { cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; } catch (_) { cur = {}; }
    if (event.type === 'org:start') {
      cur.runId = event.runId || cur.runId;
      cur.status = 'running';
      cur.startedAt = ts;
      cur.checkpointInterval = event.checkpointInterval || 600000;
      cur.agentStates = {};
    } else if (event.type === 'org:stop') {
      cur.status = 'idle';
    } else if (event.type === 'org:agent:online') {
      cur.agentStates = cur.agentStates || {};
      cur.agentStates[String(event.from || '').trim()] = { status: 'active', lastSeen: ts };
    } else if (event.type === 'org:agent:offline') {
      if (cur.agentStates?.[String(event.from || '').trim()]) {
        cur.agentStates[String(event.from).trim()].status = 'idle';
      }
    }
    cur.lastEventAt = ts;
    try { fs.mkdirSync(orgsDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cur, null, 2)); } catch (_) {}
  } else {
    // Frequent event: debounce lastEventAt write by 5s
    const existing = _runstateDebouncers.get(orgName);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      _runstateDebouncers.delete(orgName);
      try {
        if (!fs.existsSync(file)) return;
        const rs = JSON.parse(fs.readFileSync(file, 'utf8'));
        rs.lastEventAt = Date.now();
        fs.writeFileSync(file, JSON.stringify(rs, null, 2));
      } catch (_) {}
    }, 5000);
    _runstateDebouncers.set(orgName, { timer });
  }
}
// ── End runstate helpers ─────────────────────────────────────────────────

// Server state
let running = false;
let currentPort = null;
let currentUrl = null;
let activeServer = null;
const activeWatchers = [];

// broadcast() is imported from sse-manager.mjs

/**
 * Opens a URL in the default browser, cross-platform.
 */
async function openUrl(url) {
  const { exec } = await import('child_process');
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
      ? `start "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd);
}

/**
 * Attempts to bind the HTTP server to a port, trying up to 10 increments
 * if the initial port is already in use.
 */
function bindServer(server, port) {
  return new Promise((resolve, reject) => {
    const maxTries = 10;
    let attempt = 0;

    function tryPort(p) {
      server.listen(p, () => resolve(p));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempt < maxTries) {
          attempt += 1;
          server.removeAllListeners('error');
          tryPort(p + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(port);
  });
}

/**
 * Starts the monomind live dashboard HTTP server.
 *
 * @param {object} [options]
 * @param {number}  [options.port=4242]        - Preferred port. Tries up to port+10 on collision.
 * @param {string}  [options.projectDir]       - Root of the project to collect data from.
 * @param {boolean} [options.openBrowser=true] - Whether to open the dashboard in the default browser.
 * @returns {Promise<{port: number, url: string, server: http.Server}>}
 */
/**
 * Resolve a Claude project slug back to the real filesystem path.
 * Slugs are created by replacing all '/' with '-', so paths containing
 * hyphens (like agent-f/agf-accounting) are ambiguous. This function
 * uses a greedy BFS over the real filesystem to find the correct path.
 * Falls back to cwd in session files, then to direct slug replacement.
 */
function resolveSlugToPath(slug, projDir) {
  // 1. Try filesystem BFS (most reliable)
  const parts = slug.replace(/^-/, '').split('-');
  function tryPaths(idx, current) {
    if (idx === parts.length) return fs.existsSync(current) ? current : null;
    // Option A: next part is a new path component
    const asDir = path.join(current, parts[idx]);
    const r1 = tryPaths(idx + 1, asDir);
    if (r1) return r1;
    // Option B: combine with hyphen into current basename
    if (current !== '/') {
      const combined = path.join(path.dirname(current), path.basename(current) + '-' + parts[idx]);
      const r2 = tryPaths(idx + 1, combined);
      if (r2) return r2;
    }
    return null;
  }
  const fsResolved = parts.length ? tryPaths(1, '/' + parts[0]) : null;
  if (fsResolved) return fsResolved;

  // 2. Try reading cwd from a session file
  try {
    const sfiles = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
    for (const sf of sfiles) {
      try {
        const line = fs.readFileSync(path.join(projDir, sf), 'utf-8').split('\n').find(l => l.includes('"cwd"'));
        if (line) { const m = line.match(/"cwd"\s*:\s*"([^"]+)"/); if (m?.[1]) return m[1]; }
      } catch {}
    }
  } catch {}

  // 3. Dumb fallback (known-broken for hyphenated dirs, but last resort)
  return slug.replace(/-/g, '/');
}

export async function startServer({ port = 4242, projectDir, openBrowser = true } = {}) {
  // Parse a .claude/agents/*.md definition into { name, description, capability{}, document }.
  // Tolerant line-based parse of the YAML frontmatter (expertise / task_types as lists).
  function parseAgentDef(raw) {
    const out = { name: '', description: '', capability: {}, document: '' };
    const fm = String(raw).match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    let front = '', body = String(raw);
    if (fm) { front = fm[1]; body = fm[2]; }
    out.document = body.trim();
    const strip = (s) => s.trim().replace(/^["']|["']$/g, '');
    let inCap = false, listKey = null;
    for (const line of front.split('\n')) {
      const top = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (top && !/^\s/.test(line)) {
        inCap = (top[1] === 'capability'); listKey = null;
        if (top[1] === 'name') out.name = strip(top[2]);
        else if (top[1] === 'description') out.description = strip(top[2]);
        continue;
      }
      if (!inCap) continue;
      const li = line.match(/^\s+-\s+(.+)$/);
      if (li && listKey) { (out.capability[listKey] = out.capability[listKey] || []).push(strip(li[1])); continue; }
      const kv = line.match(/^\s+([a-z_]+):\s*(.*)$/i);
      if (kv) {
        if (kv[2].trim() === '') { listKey = kv[1]; out.capability[kv[1]] = out.capability[kv[1]] || []; }
        else { listKey = null; out.capability[kv[1]] = strip(kv[2]); }
      }
    }
    return out;
  }

  // ── handleMastermindEvent ─────────────────────────────────────────────────
  // Extracted from the request dispatcher to reduce cyclomatic complexity.
  // Handles POST /api/mastermind/event: parses body, enriches with runId/session,
  // persists to JSONL files, broadcasts to SSE clients, returns {ok:true}.
  async function handleMastermindEvent(req, res) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 2097152) { req.destroy(); break; } }
    let event = {};
    try { event = JSON.parse(body); } catch (_) {}
    event.ts = event.ts || Date.now();
    // Event type validation: accept any {scope}:{action} pattern — future event types
    // auto-work without whitelist maintenance. Malformed types are logged and rejected.
    if (event.type != null) {
      if (typeof event.type !== 'string' || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/.test(event.type)) {
        try {
          const _badLog = path.join(projectDir || process.cwd(), 'data', 'unknown-events.jsonl');
          fs.mkdirSync(path.dirname(_badLog), { recursive: true });
          fs.appendFileSync(_badLog, JSON.stringify({ ts: Date.now(), type: event.type, body: body.slice(0, 256) }) + '\n');
        } catch (_) {}
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid event type' }));
        return;
      }
    }
    // Use project path from event if provided (multi-project support).
    // Security: path.isAbsolute() alone is insufficient — an attacker can
    // supply event.project="/etc" and cause writes to system directories.
    // Only accept paths that resolve to an existing directory AND are not
    // the filesystem root (/), AND are not obviously system paths.
    // Cap to 4096 chars to prevent OOM from huge path strings.
    const _rawProject = event.project;
    let eventProject = null;
    if (typeof _rawProject === 'string' && _rawProject.length > 0 && _rawProject.length <= 4096
        && path.isAbsolute(_rawProject)) {
      // Reject filesystem root and common system directories
      const _norm = path.resolve(_rawProject);
      const _systemPaths = ['/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev', '/sys', '/proc', '/tmp', os.tmpdir(), (() => { try { return fs.realpathSync(os.tmpdir()); } catch (_) { return ''; } })()].filter(Boolean);
      if (!_systemPaths.includes(_norm) && !_systemPaths.some(p => _norm.startsWith(p + '/'))) {
        eventProject = _norm;
      }
    }
    const root = eventProject || projectDir || process.cwd();
    const dataDir = path.join(root, 'data');
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
    // Track known project dirs for aggregated session listing
    if (eventProject) {
      const knownFile = path.join(projectDir || process.cwd(), 'data', 'known-projects.json');
      try {
        let known = [];
        try { known = JSON.parse(fs.readFileSync(knownFile, 'utf8')); } catch (_) {}
        if (!known.includes(eventProject)) { known.push(eventProject); fs.writeFileSync(knownFile, JSON.stringify(known)); }
      } catch (_) {}
    }
    // Track active runs and enrich event with runId BEFORE persisting so the JSONL replay
    // on SSE reconnect contains the same enriched event that live clients received.
    // Previously this was done AFTER the appendFileSync, causing org:comms events stored in
    // mastermind-events.jsonl to lack runId — _odtHandleLiveEvent dropped them on reconnect.
    if (event.org) {
      const _orgKey = String(event.org).trim();
      // Any event with both org+runId updates the active run map (run:start written directly to file so org:start is first via curl)
      if (event.runId) activeOrgRuns.set(_orgKey, String(event.runId).trim());
      else if (activeOrgRuns.has(_orgKey)) event.runId = activeOrgRuns.get(_orgKey);
      else { const _rsId = _getActiveRunId(_orgKey, root); if (_rsId) event.runId = _rsId; }
      if (event.type === 'run:complete' || event.type === 'org:complete' || event.type === 'org:stop') activeOrgRuns.delete(_orgKey);
      // Persist active-run.json so capture-handler.cjs can find the current org/runId without HTTP calls.
      // Use process.cwd() (server's own dir, same as CLAUDE_PROJECT_DIR in the session) — not root (org project dir),
      // because capture-handler.cjs reads from CLAUDE_PROJECT_DIR which is the server's working directory.
      try {
        const _captureDir = path.join(MONOMIND_HOME, '.monomind', 'capture');
        const _activeRunFile = path.join(_captureDir, 'active-run.json');
        if ((event.type === 'run:start' || event.type === 'org:start') && event.org && event.runId) {
          fs.mkdirSync(_captureDir, { recursive: true });
          fs.writeFileSync(_activeRunFile, JSON.stringify({ org: String(event.org).trim(), runId: String(event.runId).trim(), ts: Date.now() }));
        } else if ((event.type === 'run:complete' || event.type === 'org:complete' || event.type === 'org:stop') && fs.existsSync(_activeRunFile)) {
          fs.unlinkSync(_activeRunFile);
          // Phase 1: Clean up ppid-keyed files for this org (Issue 3)
          try {
            const _ppidDir = path.join(_captureDir, 'active-runs');
            const _completedOrg = String(event.org || '').trim();
            if (_completedOrg && fs.existsSync(_ppidDir)) {
              fs.readdirSync(_ppidDir).filter(f => f.endsWith('.json')).forEach(_pf => {
                try {
                  const _pData = JSON.parse(fs.readFileSync(path.join(_ppidDir, _pf), 'utf8'));
                  if (_pData.org === _completedOrg) fs.unlinkSync(path.join(_ppidDir, _pf));
                } catch (_) {}
              });
            }
          } catch (_e) {}
        }
      } catch(_e) {}
    }
    // Update durable runstate.json — survives server restarts
    if (event.org) _updateRunState(event, root);
    appendToFile(path.join(dataDir, 'mastermind-events.jsonl'), JSON.stringify(event) + '\n').catch(() => {});
    // Persist to git-safe run file (survives branch switches + shared across worktrees)
    if (event.org && event.runId) {
      try {
        const _orn = String(event.org).trim();
        const _rid = String(event.runId).trim();
        if (_orn.length > 0 && _orn.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/i.test(_orn)
            && _rid.length > 0 && _rid.length <= 80 && /^[a-z0-9][a-z0-9_-]*$/i.test(_rid)) {
          const _monoDir = _getGitMonomindDir(root) || path.join(root, '.monomind');
          const _runDir = path.join(_monoDir, 'orgs', _orn, 'runs');
          fs.mkdirSync(_runDir, { recursive: true });
          await appendToFile(path.join(_runDir, `${_rid}.jsonl`), JSON.stringify(event) + '\n');
          _insertRunEvent(event, 'http');
          // agent:usage — persist per-role token/cost data to state.json (accumulated across runs)
          if (event.type === 'agent:usage' && event.role) {
            try {
              const _arole = String(event.role).trim();
              if (_arole.length > 0 && _arole.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/i.test(_arole)) {
                const _stateFile = path.join(root, '.monomind', 'orgs', `${_orn}-state.json`);
                let _st = {};
                try { _st = JSON.parse(fs.readFileSync(_stateFile, 'utf8')); } catch(_e) {}
                if (!_st.agents) _st.agents = {};
                const _ex = _st.agents[_arole] || {};
                _st.agents[_arole] = {
                  ..._ex,
                  tokens_in: (_ex.tokens_in || 0) + (Number(event.tokens_in) || 0),
                  tokens_out: (_ex.tokens_out || 0) + (Number(event.tokens_out) || 0),
                  total_cost_usd: (_ex.total_cost_usd || 0) + (Number(event.cost_usd) || 0),
                  lastUpdated: event.ts,
                };
                fs.writeFileSync(_stateFile, JSON.stringify(_st, null, 2));
              }
            } catch(_e) {}
          }
          // Solution 3: dedicated conversation log — org:comms only, for easy replay
          if (event.type === 'org:comms') {
            const _conv = { ts: event.ts, run_id: _rid, from: event.from, to: event.to, msg: event.msg };
            await appendToFile(path.join(_runDir, `${_rid}.convs.jsonl`), JSON.stringify(_conv) + '\n');
            // Also write to org-level threads.jsonl so the dashboard Threads tab shows agent conversations
            const _orgThreadsFile = path.join(root, '.monomind', 'orgs', `${_orn}-threads.jsonl`);
            const _thread = { type: 'message', id: `${_rid}-${event.ts}`, run_id: _rid, ts: event.ts, from: event.from, to: event.to, msg: event.msg, subject: `Run ${_rid}` };
            appendToFile(_orgThreadsFile, JSON.stringify(_thread) + '\n').catch(() => {});
          }
          // Phase 4: Compact completed run to three-tier retention (Issue 7)
          // hot (SQLite JSONL in .monomind) → warm (flat JSONL in archive/) → cold (gzip)
          // We use a lightweight approach: rename completed JSONL to .warm.jsonl, then gzip runs
          // older than 24 hours to .cold.jsonl.gz — no external deps.
          if (event.type === 'run:complete' || event.type === 'org:complete') {
            setImmediate(() => {
              try {
                const _hotFile = path.join(_runDir, `${_rid}.jsonl`);
                const _warmFile = path.join(_runDir, `${_rid}.warm.jsonl`);
                // Promote: hot → warm (just rename — same dir, marks run as done)
                if (fs.existsSync(_hotFile) && !fs.existsSync(_warmFile)) {
                  fs.renameSync(_hotFile, _warmFile);
                }
                // Compact warm files older than 24h to cold gzip
                const _24h = 24 * 60 * 60 * 1000;
                fs.readdirSync(_runDir).filter(f => f.endsWith('.warm.jsonl')).forEach(_wf => {
                  const _wp = path.join(_runDir, _wf);
                  try {
                    if (Date.now() - fs.statSync(_wp).mtimeMs < _24h) return;
                    const _coldPath = _wp.replace('.warm.jsonl', '.cold.jsonl.gz');
                    if (fs.existsSync(_coldPath)) return; // already compacted
                    const _warmData = fs.readFileSync(_wp);
                    const zlib = require('zlib');
                    zlib.gzip(_warmData, (_err, _gz) => {
                      if (_err) return;
                      try {
                        fs.writeFileSync(_coldPath, _gz);
                        fs.unlinkSync(_wp); // remove warm after cold written
                      } catch (_) {}
                    });
                  } catch (_) {}
                });
              } catch (_) {}
            });
          }
        }
      } catch (_) {}
    }
    // ── Active session tracking: link org:comms / agent:usage events to current session ──
    // This must run BEFORE session persistence so events without session get enriched.
    try {
      const _evOrg = event.org ? String(event.org).trim() : null;
      if (event.type === 'session:start' && event.session && _evOrg) {
        activeSessionsByOrg.set(_evOrg, { sessionId: String(event.session), ts: event.ts || Date.now() });
        // Write active-session.json so capture-handler.cjs can read it without HTTP
        try {
          const _captureDir = path.join(root, '.monomind', 'capture');
          fs.mkdirSync(_captureDir, { recursive: true });
          fs.writeFileSync(path.join(_captureDir, 'active-session.json'),
            JSON.stringify({ org: _evOrg, sessionId: String(event.session), ts: Date.now() }));
        } catch(_) {}
      } else if (event.type === 'session:complete' && _evOrg) {
        activeSessionsByOrg.delete(_evOrg);
        try { fs.unlinkSync(path.join(root, '.monomind', 'capture', 'active-session.json')); } catch(_) {}
      }
      // Enrich events that have org but no session (agent:usage, org:comms, agent:spawn, intercom)
      if (_evOrg && !event.session && activeSessionsByOrg.has(_evOrg)) {
        event.session = activeSessionsByOrg.get(_evOrg).sessionId;
      }
    } catch(_) {}
    // ── Per-session JSONL persistence (append-only, O(1) per event) ──────────
    // Replaces the old monolithic mastermind-sessions.json (O(N) read+write per event).
    // Format: data/sessions/<sessionId>.jsonl  +  data/sessions/_index.json
    try {
      const _sid = String(event.session || '').trim();
      if (_sid.length > 0 && _sid.length <= 128 && /^(?!.*\.\.)[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(_sid)) {
        const sessDir = path.join(dataDir, 'sessions');
        fs.mkdirSync(sessDir, { recursive: true });
        // Append event to per-session JSONL (O(1), no read)
        appendToFile(path.join(sessDir, `${_sid}.jsonl`), JSON.stringify(event) + '\n').catch(() => {});
        // Update lightweight index (id, ts, prompt, status, org, startedAt, endedAt, domains only)
        const indexFile = path.join(sessDir, '_index.json');
        let _idx = [];
        try { _idx = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch(_) {}
        const _entry = _idx.find(e => e.id === _sid);
        if (event.type === 'session:start') {
          if (!_entry) {
            _idx.unshift({ id: _sid, ts: event.ts, prompt: event.prompt || '', status: 'running',
              org: event.org || '', startedAt: event.ts, domains: [] });
            if (_idx.length > 2000) _idx = _idx.slice(0, 2000);
          }
        } else if (_entry) {
          if (event.type === 'session:complete') { _entry.status = event.status || 'complete'; _entry.endedAt = event.ts; }
          if (event.type === 'domain:dispatch' && event.domain) {
            _entry.domains = _entry.domains || [];
            if (!_entry.domains.includes(event.domain)) _entry.domains.push(event.domain);
          }
          if (event.type === 'agent:usage' || event.type === 'agent:spawn' || event.type === 'agent:complete') {
            _entry.hasAgents = true;
          }
        }
        fs.writeFileSync(indexFile, JSON.stringify(_idx));
      }
    } catch (_) {}
    // ── Legacy mastermind-sessions.json (kept for backwards compat, read by old clients) ──
    try {
      const sessFile = path.join(dataDir, 'mastermind-sessions.json');
      let sessions = [];
      try { sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8')); } catch (_) {}
      if (event.type === 'session:start' && event.session) {
        if (!sessions.find(s => s.id === event.session)) {
          sessions.unshift({ id: event.session, ts: event.ts, prompt: event.prompt || '',
            status: 'running', org: event.org || '', domains: [], startedAt: event.ts });
        }
      } else if (event.session) {
        const s = sessions.find(s => s.id === event.session);
        if (s) {
          if (event.type === 'session:complete') { s.status = event.status || 'complete'; s.endedAt = event.ts; }
          if (event.type === 'domain:dispatch' && event.domain && !s.domains?.includes(event.domain))
            (s.domains = s.domains || []).push(event.domain);
        }
      }
      fs.writeFileSync(sessFile, JSON.stringify(sessions.slice(0, 500)));
    } catch (_) {}
    // For org:stop events, write a stop marker the boss agent can detect
    // For org:start events, remove any existing stop marker so the org shows as running again
    if ((event.type === 'org:stop' || event.type === 'org:start') && event.org) {
      try {
        const orgName = String(event.org).trim();
        // Validate before any filesystem use — reject rather than strip
        if (orgName.length > 0 && orgName.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
          const stopDir = path.join(root, '.monomind', 'orgs', '.stops');
          if (event.type === 'org:stop') {
            fs.mkdirSync(stopDir, { recursive: true });
            fs.writeFileSync(path.join(stopDir, `${orgName}.stop`), String(Date.now()));
          } else {
            // org:start — remove stop file so the org can appear running
            try { fs.unlinkSync(path.join(stopDir, `${orgName}.stop`)); } catch (_) {}
          }
        }
      } catch (_) {}
    }
    // Broadcast to all mastermind SSE clients
    broadcastMm(event);
    // Phase 3: Forward to per-org streaming tail clients
    if (event.org) {
      const _fwdOrg = String(event.org).trim();
      const _fwdClients = runStreamClients.get(_fwdOrg);
      if (_fwdClients && _fwdClients.size > 0) {
        const _fwdLine = `data: ${JSON.stringify(event)}\n\n`;
        for (const _fwdClient of _fwdClients) {
          try { _fwdClient.write(_fwdLine); } catch (_) { _fwdClients.delete(_fwdClient); }
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"ok":true}');
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    // ------------------------------------------------------------------ GET /
    if (req.method === 'GET' && url === '/') {
      const htmlPath = path.join(__dirname, 'dashboard.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Failed to load dashboard.html: ${err.message}`);
      }
      return;
    }

    // ------------------------------------------------- GET /data/avatars/*.svg (agent avatars)
    if (req.method === 'GET' && /^\/data\/avatars\/[A-Za-z0-9._-]+\.svg$/.test(url)) {
      try {
        const name = path.basename(decodeURIComponent(url));
        if (!/^[A-Za-z0-9._-]+\.svg$/.test(name) || name.includes('..')) { res.writeHead(400); res.end(); return; }
        const avatarsDir = path.join(__dirname, 'data', 'avatars');
        const filePath = path.join(avatarsDir, name);
        if (!filePath.startsWith(avatarsDir + path.sep) || !fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
        const svg = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
        res.end(svg);
      } catch (_) { res.writeHead(404); res.end(); }
      return;
    }

    // ----------------------------------------------------------------- GET /v2 (alias → /)
    if (req.method === 'GET' && url === '/v2') {
      res.writeHead(301, { 'Location': '/' });
      res.end();
      return;
    }

    // --------------------------------------------------------- GET /api/git-user
    if (req.method === 'GET' && url === '/api/git-user') {
      try {
        const { execSync: gitExec } = await import('child_process');
        const cwd = projectDir || process.cwd();
        const name = gitExec('git config user.name', { cwd, encoding: 'utf8' }).trim();
        const email = gitExec('git config user.email', { cwd, encoding: 'utf8' }).trim();
        let remoteUrl = '';
        try { remoteUrl = gitExec('git remote get-url origin', { cwd, encoding: 'utf8' }).trim(); } catch {}
        // Normalise SSH remote to HTTPS URL for browser linking
        if (remoteUrl.startsWith('git@')) {
          remoteUrl = remoteUrl.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
        } else if (remoteUrl.endsWith('.git')) {
          remoteUrl = remoteUrl.slice(0, -4);
        }
        let branch = '';
        try { branch = gitExec('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim(); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ name, email, cwd, remoteUrl, branch }));
      } catch (_) {
        const cwd2 = projectDir || process.cwd();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ name: '', email: '', cwd: cwd2, remoteUrl: '', branch: '' }));
      }
      return;
    }

    // --------------------------------------------------------- GET /api/data
    if (req.method === 'GET' && url === '/api/data') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const snapshot = await collectAll(dir);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify(snapshot));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------ GET /api/session
    if (req.method === 'GET' && url === '/api/session') {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const file = qs.get('file');
      const limit = Math.min(parseInt(qs.get('limit') || '600', 10), 3000);
      if (!file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing file param' }));
        return;
      }
      try {
        // Security: validate that the requested file stays within the user's
        // home directory. Without this, ?file=/etc/passwd discloses arbitrary
        // system files to any process that can reach localhost:4242.
        const _resolvedFile = path.resolve(file);
        const _homeDir = os.homedir();
        if (!_resolvedFile.startsWith(_homeDir + path.sep) && !_resolvedFile.startsWith(_homeDir)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access denied: file must be within the home directory' }));
          return;
        }
        // Only allow JSONL files (session logs).
        if (!_resolvedFile.endsWith('.jsonl')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access denied: only .jsonl files are permitted' }));
          return;
        }
        const raw = fs.readFileSync(_resolvedFile, 'utf8');
        const allLines = raw.split('\n').filter(Boolean);
        const lines = allLines.slice(-limit);
        const events = parseSessionLines(lines);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ events, total: allLines.length, shown: lines.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/session-journal
    if (req.method === 'GET' && url === '/api/session-journal') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);

        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(projectClaudeDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => { try { return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 50);
        } catch {}

        const sessions = [];
        for (const { f, mtime } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const id = f.replace('.jsonl', '');
          let lastPrompt = '', summaries = [], totalDurationMs = 0, totalMessages = 0, firstTs = null, lastTs = null, totalCost = 0, toolCalls = 0, userMessages = 0, cacheReadTokens = 0, totalInputTokens = 0, errorCount = 0;
          const modelBreakdown = {};
          const filesTouchedSet = new Set();
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            let pendingCompact = false;
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.timestamp) { if (!firstTs) firstTs = e.timestamp; lastTs = e.timestamp; }
              if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
              if (e.type === 'user') {
                userMessages++;
                for (const b of (e.message?.content || [])) {
                  if (b && b.type === 'tool_result' && b.is_error) errorCount++;
                }
              }
              if (e.type === 'system' && e.subtype === 'compact_boundary') pendingCompact = true;
              if (pendingCompact && e.type === 'user') {
                const msg = e.message || {};
                const ct = msg.content || [];
                let text = '';
                if (Array.isArray(ct)) { for (const b of ct) { if (b && b.type === 'text') { text = b.text; break; } } }
                else if (typeof ct === 'string') text = ct;
                const m = text.match(/Summary:\s*([\s\S]+)/);
                if (m) summaries.push({ ts: e.timestamp, text: m[1].trim() });
                pendingCompact = false;
              }
              if (e.type === 'assistant') {
                const msg = e.message || {};
                for (const block of (msg.content || [])) {
                  if (block && block.type === 'tool_use') {
                    toolCalls++;
                    if (['Write','Edit','Read','MultiEdit'].includes(block.name) && block.input?.file_path) {
                      filesTouchedSet.add(path.basename(block.input.file_path));
                    }
                  }
                }
                if (msg.usage && msg.model) {
                  const c = _sjCalcCost(msg.model, msg.usage);
                  totalCost += c;
                  const mk = msg.model.replace(/@.*$/, '').replace(/-\d{8}$/, '');
                  if (!modelBreakdown[mk]) modelBreakdown[mk] = { calls: 0, cost: 0 };
                  modelBreakdown[mk].calls++;
                  modelBreakdown[mk].cost += c;
                  cacheReadTokens += (msg.usage.cache_read_input_tokens || 0);
                  totalInputTokens += (msg.usage.input_tokens || 0)
                                    + (msg.usage.cache_creation_input_tokens || 0)
                                    + (msg.usage.cache_read_input_tokens || 0);
                }
              }
              if (e.type === 'system' && e.subtype === 'turn_duration') {
                totalDurationMs += e.durationMs || 0;
                if ((e.messageCount || 0) > totalMessages) totalMessages = e.messageCount;
              }
            }
          } catch {}
          const filesTouched = [...filesTouchedSet].slice(0, 20);
          const compactCount = summaries.length;
          const summary = summaries.length ? summaries[summaries.length - 1].text : null;
          sessions.push({ id, mtime, firstTs, lastTs, lastPrompt, summaries, summary, compactCount, errorCount, totalDurationMs, totalMessages, totalCost, toolCalls, userMessages, cacheReadTokens, totalInputTokens, modelBreakdown, filesTouched, file: fp });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ sessions }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/search-sessions
    if (req.method === 'GET' && url === '/api/search-sessions') {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || '';
      const q = (qs.get('q') || '').toLowerCase().trim();
      if (!q || q.length < 2) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ results: [] }));
        return;
      }
      try {
        const d = path.resolve(dir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(projectClaudeDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => { try { return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 20);
        } catch {}
        const results = [];
        for (const { f, mtime } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const id = f.replace('.jsonl', '');
          let lastPrompt = '';
          const matches = [];
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
              if (e.type === 'user') {
                const msg = e.message || {};
                const ct = msg.content || [];
                let text = '';
                if (Array.isArray(ct)) { for (const b of ct) { if (b && b.type === 'text') { text = b.text; break; } } }
                else if (typeof ct === 'string') text = ct;
                if (text.toLowerCase().includes(q)) matches.push({ text: text.slice(0, 150), ts: e.timestamp });
              }
              if (matches.length >= 3) break;
            }
          } catch {}
          if (matches.length) results.push({ id, file: fp, lastPrompt, mtime, matches });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ results, q }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/recent-events
    if (req.method === 'GET' && url === '/api/recent-events') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const limit = Math.min(parseInt(qs.get('limit') || '50', 10), 200);
        const d = path.resolve(dir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(projectClaudeDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => { try { return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 5); // check last 5 sessions
        } catch {}

        const events = [];
        const HOOK_RE = /^<(local-command-|command-name>|command-message>)/;
        for (const { f } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const sessId = f.replace('.jsonl', '');
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).slice(-200);
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'assistant') {
                const content = e.message?.content || [];
                for (const block of content) {
                  if (block?.type === 'tool_use') {
                    events.push({ kind: 'tool', ts: e.timestamp, tool: block.name, session: sessId });
                  }
                }
              } else if (e.type === 'user') {
                const content = e.message?.content || [];
                for (const block of content) {
                  if (block?.type === 'text' && block.text?.trim() && !HOOK_RE.test(block.text.trim())) {
                    events.push({ kind: 'user', ts: e.timestamp, text: block.text.slice(0, 120), session: sessId });
                  }
                }
              }
            }
          } catch {}
        }

        // sort by ts desc, take limit
        events.sort((a, b) => {
          const ta = a.ts ? new Date(a.ts).getTime() : 0;
          const tb = b.ts ? new Date(b.ts).getTime() : 0;
          return tb - ta;
        });

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ events: events.slice(0, limit) }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/tool-errors
    if (req.method === 'GET' && url === '/api/tool-errors') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(projectClaudeDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => { try { return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean).sort((a,b) => b.mtime - a.mtime).slice(0, 10);
        } catch {}
        // tool_use id → name map, then count is_error:true tool_result per tool name
        const errorCounts = {}, totalCounts = {};
        for (const { f } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            const toolIdMap = {};
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'assistant') {
                for (const b of (e.message?.content || [])) {
                  if (b && b.type === 'tool_use') { toolIdMap[b.id] = b.name; totalCounts[b.name] = (totalCounts[b.name] || 0) + 1; }
                }
              }
              if (e.type === 'user') {
                for (const b of (e.message?.content || [])) {
                  if (b && b.type === 'tool_result' && b.is_error) {
                    const name = toolIdMap[b.tool_use_id] || '?';
                    errorCounts[name] = (errorCounts[name] || 0) + 1;
                  }
                }
              }
            }
          } catch {}
        }
        const errors = Object.entries(errorCounts)
          .map(([tool, count]) => ({ tool, count, total: totalCounts[tool] || count }))
          .sort((a,b) => b.count - a.count);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ errors }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/tool-ranking
    if (req.method === 'GET' && url === '/api/tool-ranking') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(projectClaudeDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => { try { return { f, mtime: fs.statSync(path.join(projectClaudeDir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean).sort((a,b) => b.mtime - a.mtime).slice(0, 30);
        } catch {}
        const toolCounts = {}, errorCounts = {};
        for (const { f } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            const toolIdMap = {};
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'assistant') {
                for (const b of (e.message?.content || [])) {
                  if (b && b.type === 'tool_use') { toolIdMap[b.id] = b.name; toolCounts[b.name] = (toolCounts[b.name] || 0) + 1; }
                }
              }
              if (e.type === 'user') {
                for (const b of (e.message?.content || [])) {
                  if (b && b.type === 'tool_result' && b.is_error) {
                    const name = toolIdMap[b.tool_use_id] || '?';
                    errorCounts[name] = (errorCounts[name] || 0) + 1;
                  }
                }
              }
            }
          } catch {}
        }
        const tools = Object.entries(toolCounts)
          .map(([tool, count]) => ({ tool, count, errors: errorCounts[tool] || 0 }))
          .sort((a,b) => b.count - a.count);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ tools }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/project-costs
    if (req.method === 'GET' && url === '/api/project-costs') {
      try {
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        let slugDirs = [];
        try { slugDirs = fs.readdirSync(projectsBase, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
        const projectCosts = [];
        for (const slug of slugDirs) {
          const projDir = path.join(projectsBase, slug);
          const projPath = resolveSlugToPath(slug, projDir);
          let sessionFiles = [];
          try { sessionFiles = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl')).map(f => path.join(projDir, f)); } catch {}
          if (!sessionFiles.length) continue;
          let totalCost = 0;
          for (const fp of sessionFiles) {
            try {
              const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
              for (const line of lines) {
                let e; try { e = JSON.parse(line); } catch { continue; }
                if (e.type === 'assistant' && e.message?.usage) { totalCost += _sjCalcCost(e.message.model || '', e.message.usage); }
              }
            } catch {}
          }
          if (totalCost > 0) projectCosts.push({ path: projPath, cost: totalCost, sessions: sessionFiles.length });
        }
        projectCosts.sort((a, b) => b.cost - a.cost);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ projects: projectCosts }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/projects
    if (req.method === 'GET' && url === '/api/projects') {
      try {
        const projectsBase = path.join(os.homedir(), '.claude', 'projects');
        let slugDirs = [];
        try { slugDirs = fs.readdirSync(projectsBase, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
        const projects = slugDirs.map(slug => {
          const projDir = path.join(projectsBase, slug);
          const projPath = resolveSlugToPath(slug, projDir);
          const name = projPath.split('/').filter(Boolean).pop() || slug.split('-').filter(Boolean).pop() || slug;
          let sessionCount = 0; let lastActivity = 0; let memoryCount = 0;
          try {
            const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
            sessionCount = files.length;
            for (const f of files) {
              try { const st = fs.statSync(path.join(projDir, f)); if (st.mtimeMs > lastActivity) lastActivity = st.mtimeMs; } catch {}
            }
          } catch {}
          try {
            const memDir = path.join(projDir, 'memory');
            memoryCount = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').length;
          } catch {}
          return { slug, path: projPath, name, sessionCount, memoryCount, lastActivity: lastActivity || null };
        }).filter(p => p.sessionCount > 0 || fs.existsSync(path.join(p.path, '.monomind'))).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ projects }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/palace
    if (req.method === 'GET' && url === '/api/palace') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const palaceDir = path.join(d, '.monomind', 'palace');

        let drawers = [];
        try {
          const raw = fs.readFileSync(path.join(palaceDir, 'drawers.jsonl'), 'utf8');
          drawers = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        } catch {}

        let identity = null;
        try { identity = fs.readFileSync(path.join(palaceDir, 'identity.md'), 'utf8'); } catch {}

        let kg = [];
        try { const raw = fs.readFileSync(path.join(palaceDir, 'kg.json'), 'utf8'); kg = JSON.parse(raw); } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ drawers, identity, kg }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/adrs
    if (req.method === 'GET' && url.startsWith('/api/adrs')) {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());

        const adrDirs = [
          { path: path.join(d, 'docs', 'adrs'), group: 'all' },
        ];

        const adrs = [];
        for (const { path: adrDir, group } of adrDirs) {
          if (!fs.existsSync(adrDir)) continue;
          const files = fs.readdirSync(adrDir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'v3-adrs.md' && f !== 'SECURITY-REVIEW-SUMMARY.md');
          for (const fname of files.sort()) {
            const resolvedGroup = /^ADR-G/i.test(fname) ? 'guidance' : 'implementation';
            try {
              const raw = fs.readFileSync(path.join(adrDir, fname), 'utf8');
              const titleMatch = raw.match(/^#\s+(.+)$/m);
              const header = raw.split('\n').slice(0, 20).join('\n');
              const statusTableMatch = header.match(/^\|\s*\*{0,2}Status\*{0,2}\s*\|\s*\*{0,2}([^|*\n]{2,40}?)\*{0,2}\s*\|/im);
              const statusInlineMatch = header.match(/\*\*Status[:\s]+\*?\*?\s*(Accepted|Implemented|Proposed|Superseded|Deprecated|Draft|Rejected|Complete|Active|Retired)[^*]*/i);
              const statusMatch = statusTableMatch || statusInlineMatch;
              const dateInlineMatch = header.match(/\*\*Date[:\s]+\*?\*?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
              const dateMatch = raw.match(/\|\s*\*{0,2}Date\*{0,2}\s*\|\s*\*{0,2}([^|*\n]+?)\*{0,2}\s*\|/i) || dateInlineMatch || raw.match(/Date[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2})/);
              const numMatch = fname.match(/ADR-([A-Z]*[0-9]+)/i);
              const summaryMatch = raw.match(/##\s+(?:Context|Summary|Problem Statement)[^\n]*\n+([\s\S]{20,300})/i);
              adrs.push({
                number: numMatch ? 'ADR-' + numMatch[1] : fname.replace('.md', ''),
                title: titleMatch ? titleMatch[1].replace(/^ADR-[A-Z0-9-]+[:\s]+/i, '').trim() : fname.replace('.md', ''),
                status: statusMatch ? statusMatch[1].trim() : 'Unknown',
                date: dateMatch ? dateMatch[1].trim() : null,
                summary: summaryMatch ? summaryMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : null,
                group: resolvedGroup,
                file: fname,
              });
            } catch { /* skip unreadable */ }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ adrs }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/memory-files
    if (req.method === 'GET' && url === '/api/memory-files') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const homeDir = os.homedir();
        const slug = d.replace(/\//g, '-');
        const memDir = path.join(homeDir, '.claude', 'projects', slug, 'memory');

        let files = [];
        try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md'); } catch {}

        const memories = files.map(fname => {
          const fp = path.join(memDir, fname);
          let stat = null; try { stat = fs.statSync(fp); } catch {}
          let raw = ''; try { raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n'); } catch {}
          // Parse frontmatter — escHtml ordering: bold replace runs on already-escaped content (safe)
          let name = fname.replace('.md', ''), description = '', type = 'project', body = raw;
          const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
          if (fm) {
            body = fm[2].trim();
            for (const line of fm[1].split('\n')) {
              const m = line.match(/^(\w+):\s*(.+)$/);
              if (m) {
                if (m[1] === 'name') name = m[2].trim();
                if (m[1] === 'description') description = m[2].trim();
                if (m[1] === 'type') type = m[2].trim();
              }
            }
          }
          return { filename: fname, name, description, type, body, source: 'file', readonly: false, mtime: stat ? stat.mtimeMs : null };
        }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

        // Merge backend store (AgentDB / auto-memory bridge). These live in the
        // SQLite-backed store, not as .md files, so the file-only listing above
        // misses them. Surface them read-only with a source badge so the dashboard
        // reflects ALL memory, not just whatever has been flushed to disk.
        let backend = [];
        try {
          const storePath = path.join(d, '.monomind', 'data', 'auto-memory-store.json');
          if (fs.existsSync(storePath)) {
            const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            const rows = Array.isArray(raw) ? raw : (raw.entries || []);
            backend = rows
              .filter(e => e && (e.content != null) && e.status !== 'deleted')
              .map(e => ({
                filename: 'backend:' + (e.key || e.id),
                name: e.key || e.id || 'entry',
                description: e.namespace ? ('namespace: ' + e.namespace) : '',
                type: e.type || 'semantic',
                body: String(e.content),
                source: 'backend',
                readonly: true,
                mtime: e.updatedAt || e.createdAt || null,
              }))
              .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
          }
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ memories: memories.concat(backend), memDir }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- PUT /api/memory-file
    if (req.method === 'PUT' && url === '/api/memory-file') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const slug = d.replace(/\//g, '-');
          const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
          const { filename, content } = JSON.parse(body);
          if (!filename || filename.includes('..') || !filename.endsWith('.md') || filename.includes('/')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid filename' }));
            return;
          }
          const fp = path.join(memDir, filename);
          if (!fp.startsWith(memDir + path.sep) && fp !== memDir) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access denied' }));
            return;
          }
          fs.mkdirSync(memDir, { recursive: true });
          fs.writeFileSync(fp, content || '', 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------------- DELETE /api/memory-file
    if (req.method === 'DELETE' && url === '/api/memory-file') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const slug = d.replace(/\//g, '-');
          const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
          const { filename } = JSON.parse(body);
          if (!filename || filename.includes('..') || !filename.endsWith('.md') || filename.includes('/')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid filename' }));
            return;
          }
          const fp = path.join(memDir, filename);
          if (!fp.startsWith(memDir + path.sep) && fp !== memDir) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access denied' }));
            return;
          }
          fs.unlinkSync(fp);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------- GET /api/routing-feedback
    if (req.method === 'GET' && url === '/api/routing-feedback') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const feedbackPath = path.join(d, '.monomind', 'routing-feedback.jsonl');
        let rows = [];
        if (fs.existsSync(feedbackPath)) {
          const raw = fs.readFileSync(feedbackPath, 'utf-8');
          rows = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(rows));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ---------------------------------------------------- GET /api/memory/stats
    if (req.method === 'GET' && url === '/api/memory/stats') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const slug = d.replace(/\//g, '-');
        const memDir = path.join(os.homedir(), '.claude', 'projects', slug, 'memory');

        let total = 0, namespaces = 0, size = 0, lastWrite = null;
        const byType = {};
        if (fs.existsSync(memDir)) {
          const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
          total = files.length;
          namespaces = files.length; // each .md file is a memory namespace
          files.forEach(f => {
            const fp = path.join(memDir, f);
            try {
              const st = fs.statSync(fp);
              size += st.size;
              if (!lastWrite || st.mtimeMs > lastWrite) lastWrite = st.mtimeMs;
            } catch {}
            const type = f.replace('.md', '');
            byType[type] = (byType[type] || 0) + 1;
          });
        }

        // Check for AgentDB / HNSW / RVF backends
        const dbPath     = path.join(d, '.monomind', 'agentdb.db');
        const hnswPath   = path.join(d, '.monomind', 'hnsw.index');
        const rvfPath    = path.join(d, '.monomind', 'memory.rvf');

        const stats = {
          total,
          count: total,
          namespaces,
          ns: Object.keys(byType).length,
          size,
          byType,
          hnsw: fs.existsSync(hnswPath),
          agentdb: fs.existsSync(dbPath),
          rvf: fs.existsSync(rvfPath),
          lastWrite,
          memDir,
        };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ stats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ---------------------------------------------------------- GET /api/loops
    if (req.method === 'GET' && url === '/api/loops') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const cwd = qs.get('dir') || projectDir || process.cwd();
        const loopsDir = path.join(cwd, '.monomind', 'loops');
        let loops = [];
        let stopFiles = new Set();
        try {
          const files = fs.readdirSync(loopsDir).filter(f => f.endsWith('.json'));
          stopFiles = new Set(fs.readdirSync(loopsDir).filter(f => f.endsWith('.stop')).map(f => f.replace('.stop', '')));
          for (const file of files) {
            try {
              const data = JSON.parse(fs.readFileSync(path.join(loopsDir, file), 'utf-8'));
              data.stopRequested = stopFiles.has(data.id);
              loops.push(data);
            } catch {}
          }
        } catch (e) { if (e.code !== 'ENOENT') throw e; }

        // Also read .claude/scheduled_tasks.lock — active Claude Code /loop sessions
        // that haven't had their ScheduleWakeup hook fire yet (or running on older version)
        try {
          const lockPath = path.join(cwd, '.claude', 'scheduled_tasks.lock');
          if (fs.existsSync(lockPath)) {
            const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
            const sessionId = lock.sessionId;
            const pid = lock.pid;
            // Verify PID is alive
            let alive = false;
            try { process.kill(pid, 0); alive = true; } catch {}
            const alreadyTracked = loops.some(l => l.id === sessionId || l.sessionId === sessionId);
            if (alive && sessionId && !alreadyTracked && !stopFiles.has(sessionId)) {
              // Try to extract ScheduleWakeup context from session JSONL
              let loopEntry = null;
              try {
                const escaped = cwd.replace(/\//g, '-');
                const sessionFile = path.join(os.homedir(), '.claude', 'projects', escaped, `${sessionId}.jsonl`);
                if (fs.existsSync(sessionFile)) {
                  const stat = fs.statSync(sessionFile);
                  const readStart = Math.max(0, stat.size - 100000);
                  const buf = Buffer.alloc(stat.size - readStart);
                  const fd = fs.openSync(sessionFile, 'r');
                  fs.readSync(fd, buf, 0, buf.length, readStart);
                  fs.closeSync(fd);
                  const lines = buf.toString('utf-8').split('\n').filter(Boolean);
                  let lastWakeup = null;
                  for (const line of lines) {
                    try {
                      const entry = JSON.parse(line);
                      const content = entry?.message?.content;
                      if (Array.isArray(content)) {
                        for (const block of content) {
                          if (block?.type === 'tool_use' && block?.name === 'ScheduleWakeup') {
                            lastWakeup = block.input;
                          }
                        }
                      }
                    } catch {}
                  }
                  if (lastWakeup) {
                    const prompt = lastWakeup.prompt || '';
                    const reason = lastWakeup.reason || '';
                    const delaySeconds = lastWakeup.delaySeconds || 60;
                    // Parse rep info from reason e.g. "repeat run 2/10"
                    const repM = (reason || prompt).match(/(\d+)\s*\/\s*(\d+)/);
                    const currentRep = repM ? parseInt(repM[1]) : 1;
                    const maxReps = repM ? parseInt(repM[2]) : 0;
                    const repFlag = (prompt).match(/--rep\s+(\d+)/);
                    const timesFlag = (prompt).match(/--times\s+(\d+)/);
                    const finalRep = repFlag ? parseInt(repFlag[1]) : currentRep;
                    const finalMax = timesFlag ? parseInt(timesFlag[1]) : maxReps;
                    const isTillendPrompt = /--tillend/i.test(prompt);
                    const type = isTillendPrompt ? 'tillend' : (finalMax > 0 || /repeat|loop/i.test(prompt)) ? 'repeat' : 'do';
                    const cmdMatch = prompt.match(/^\s*(\/[\w:_-]+)/);
                    const command = cmdMatch ? cmdMatch[1] : '';
                    loopEntry = {
                      id: sessionId,
                      sessionId,
                      type,
                      command,
                      status: 'waiting',
                      prompt: prompt.slice(0, 300),
                      reason,
                      startedAt: lock.acquiredAt || Date.now(),
                      lastRunAt: Date.now(),
                      nextRunAt: Date.now() + delaySeconds * 1000,
                      currentRep: finalRep,
                      maxReps: finalMax,
                      interval: Math.round(delaySeconds / 60),
                      source: 'scheduled_tasks_lock',
                    };
                  }
                }
              } catch {}
              // Fallback: minimal entry from lock file alone
              if (!loopEntry) {
                loopEntry = {
                  id: sessionId,
                  sessionId,
                  type: 'do',
                  status: 'running',
                  prompt: '(active session)',
                  reason: '',
                  startedAt: lock.acquiredAt || Date.now(),
                  lastRunAt: lock.acquiredAt || Date.now(),
                  nextRunAt: null,
                  source: 'scheduled_tasks_lock',
                };
              }
              loops.push(loopEntry);
            }
          }
        } catch {}

        // Dedup: suppress scheduled_tasks_lock noise when real repeat loops exist
        const hasRepeatLoops = loops.some(l => l.source !== 'scheduled_tasks_lock' && l.source !== 'schedule_wakeup_hook');
        if (hasRepeatLoops) loops = loops.filter(l => l.source !== 'scheduled_tasks_lock' && l.source !== 'schedule_wakeup_hook');

        loops.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ loops }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    // ---------------------------------------------------------- POST /api/loops/stop
    if (req.method === 'POST' && url === '/api/loops/stop') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
          const _stopQs = new URL(req.url, 'http://localhost').searchParams;
          const _stopDir = path.resolve(_stopQs.get('dir') || projectDir || process.cwd());
          const loopsDir = path.join(_stopDir, '.monomind', 'loops');
          fs.mkdirSync(loopsDir, { recursive: true });
          fs.writeFileSync(path.join(loopsDir, `${id}.stop`), `stop-requested-${Date.now()}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    // ---------------------------------------------------------- POST /api/loops/create
    if (req.method === 'POST' && url === '/api/loops/create') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', () => {
        try {
          const _qs = new URL(req.url, 'http://localhost').searchParams;
          const { name: _rawName, prompt: _rawPrompt, interval: _rawInterval, maxReps: _rawMaxReps } = JSON.parse(body);
          // Cap field sizes to prevent individual large-field disk inflation.
          // The 2MB body cap already limits total payload, but a single field
          // near 2MB would produce a multi-MB loop config file per request.
          const MAX_LOOP_PROMPT_LEN = 64 * 1024;  // 64 KB
          const MAX_LOOP_NAME_LEN = 512;
          const MAX_LOOP_INTERVAL_LEN = 64;
          const prompt = typeof _rawPrompt === 'string' ? _rawPrompt.slice(0, MAX_LOOP_PROMPT_LEN) : null;
          const name = typeof _rawName === 'string' ? _rawName.slice(0, MAX_LOOP_NAME_LEN) : null;
          const interval = typeof _rawInterval === 'string' ? _rawInterval.slice(0, MAX_LOOP_INTERVAL_LEN) : null;
          const maxReps = typeof _rawMaxReps === 'number' && Number.isFinite(_rawMaxReps) ? Math.max(1, Math.min(Math.floor(_rawMaxReps), 10000)) : null;
          if (!prompt) { res.writeHead(400); res.end(JSON.stringify({ error: 'prompt required' })); return; }
          const loopsDir = path.join(path.resolve(_qs.get('dir') || projectDir || process.cwd()), '.monomind', 'loops');
          fs.mkdirSync(loopsDir, { recursive: true });
          const id = `loop-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
          const nowMs = Date.now();
          const loop = { id, type: 'repeat', name: name || prompt.slice(0, 40), prompt, interval: interval || '1h', maxReps, status: 'active', currentRep: 0, startedAt: nowMs, lastRunAt: null };
          fs.writeFileSync(path.join(loopsDir, `${id}.json`), JSON.stringify(loop, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, id }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    // ---------------------------------------------------------- GET /api/session-errors
    if (req.method === 'GET' && url === '/api/session-errors') {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
      // Cap sessionId to prevent O(n×m) DoS via f.includes(sessionId) substring
      // match against every filename when sessionId is a very long string.
      const _rawSessId = qs.get('id') || '';
      const sessionId = _rawSessId.slice(0, 256);
      const slug = d.replace(/\//g, '-');
      const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
      try {
        const files = fs.readdirSync(projectClaudeDir).filter(f => f.endsWith('.jsonl'));
        let fp = null;
        // Find the file matching sessionId
        for (const f of files) {
          if (f.includes(sessionId) || sessionId === f.replace('.jsonl', '')) { fp = path.join(projectClaudeDir, f); break; }
        }
        if (!fp) {
          // fallback: find by scanning
          for (const f of files) {
            const raw = fs.readFileSync(path.join(projectClaudeDir, f), 'utf8');
            const lines = raw.trim().split('\n').filter(Boolean);
            if (lines.length > 0) {
              try { const first = JSON.parse(lines[0]); if (first.sessionId === sessionId) { fp = path.join(projectClaudeDir, f); break; } } catch {}
            }
          }
        }
        if (!fp) { res.writeHead(404); res.end(JSON.stringify({ errors: [] })); return; }
        const raw = fs.readFileSync(fp, 'utf8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const errors = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const content = obj.message?.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type === 'tool_result' && block.is_error) {
                const errText = Array.isArray(block.content) ? block.content.map(c => c.text || '').join('') : String(block.content || '');
                if (errText) errors.push({ toolUseId: block.tool_use_id || '', text: errText.slice(0, 500) });
              }
            }
          } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ errors: errors.slice(0, 50) }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ errors: [], error: err.message })); }
      return;
    }

    // ---------------------------------------------------------- GET /api/events-stream (SSE)
    if (req.method === 'GET' && url.startsWith('/api/events-stream')) {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
      const slug = d.replace(/\//g, '-');
      const projectClaudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      const send = (ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
      send('connected', { ts: Date.now() });
      let watcher = null;
      try {
        watcher = fs.watch(projectClaudeDir, { persistent: false }, (evtype) => {
          if (evtype === 'change' || evtype === 'rename') send('update', { ts: Date.now() });
        });
      } catch {}
      const pingInterval = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => { clearInterval(pingInterval); try { watcher?.close(); } catch {} });
      return;
    }

    // ------------------------------------------------------- DELETE /api/knowledge-chunk
    if (req.method === 'DELETE' && url === '/api/knowledge-chunk') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const chunksFile = path.join(d, '.monomind', 'knowledge', 'chunks.jsonl');
          const { chunkId } = JSON.parse(body);
          if (!chunkId || typeof chunkId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid chunkId' }));
            return;
          }
          if (!fs.existsSync(chunksFile)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'chunks.jsonl not found' }));
            return;
          }
          const entries = fs.readFileSync(chunksFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const before = entries.length;
          const filtered = entries.filter(e => e.chunkId !== chunkId);
          if (filtered.length === before) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Chunk not found' }));
            return;
          }
          fs.writeFileSync(chunksFile, filtered.map(e => JSON.stringify(e)).join('\n') + (filtered.length ? '\n' : ''), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, removed: before - filtered.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------------- PUT /api/knowledge-chunk
    if (req.method === 'PUT' && url === '/api/knowledge-chunk') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', () => {
        try {
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const d = path.resolve(qs.get('dir') || projectDir || process.cwd());
          const chunksFile = path.join(d, '.monomind', 'knowledge', 'chunks.jsonl');
          const { chunkId, text } = JSON.parse(body);
          if (!chunkId || typeof chunkId !== 'string' || typeof text !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid chunkId or text' }));
            return;
          }
          if (!fs.existsSync(chunksFile)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'chunks.jsonl not found' }));
            return;
          }
          const entries = fs.readFileSync(chunksFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          const idx = entries.findIndex(e => e.chunkId === chunkId);
          if (idx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Chunk not found' }));
            return;
          }
          entries[idx] = { ...entries[idx], text };
          fs.writeFileSync(chunksFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ------------------------------------------------------- GET /api/monograph-html
    if (req.method === 'GET' && url === '/api/monograph-html') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');

        // Generate HTML on-the-fly from SQLite DB using the improved toHtml export
        if (fs.existsSync(dbPath)) {
          const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { toHtml } = await import(new URL('../../../../monograph/dist/src/export/html.js', import.meta.url).href);
          const db = openDb(dbPath);
          let html;
          try {
            const rawNodes = db.prepare('SELECT * FROM nodes LIMIT 5000').all();
            const rawEdges = db.prepare('SELECT * FROM edges').all();
            // Remap snake_case DB columns to camelCase MonographNode/MonographEdge interfaces
            const parsedNodes = rawNodes.map(n => ({
              id: n.id,
              label: n.label,
              name: n.name,
              normLabel: n.norm_label,
              filePath: n.file_path,
              startLine: n.start_line,
              endLine: n.end_line,
              communityId: n.community_id,
              isExported: !!n.is_exported,
              language: n.language,
              properties: n.properties ? JSON.parse(n.properties) : {},
            }));
            const parsedEdges = rawEdges.map(e => ({
              id: e.id,
              sourceId: e.source_id,
              targetId: e.target_id,
              relation: e.relation,
              confidence: e.confidence,
              confidenceScore: e.confidence_score,
              weight: e.weight,
            }));
            html = toHtml(parsedNodes, parsedEdges);
          } finally {
            closeDb(db);
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          res.end(html);
          return;
        }

        // Fallback: try legacy graph.html on disk
        const htmlPath = path.join(d, '.monomind', 'graph', 'graph.html');
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(html);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#0f0f1a;color:#888;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h3 style="color:#4E79A7;">No Graph Built Yet</h3><p>Run <code style="color:#00E5C8;">mcp__monomind__monograph_build</code> or click BUILD in the sidebar.</p></div></body></html>');
      }
      return;
    }

    // ------------------------------------------------------- GET /api/monograph-report
    if (req.method === 'GET' && url === '/api/monograph-report') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        let report = null, exists = false, stats = null;
        if (fs.existsSync(dbPath)) {
          exists = true;
          const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const db = openDb(dbPath);
          try {
            const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
            const edgeCount = db.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
            const topNodes = db.prepare(`SELECT n.id, n.name, n.label, (SELECT COUNT(*) FROM edges e WHERE e.source_id=n.id OR e.target_id=n.id) AS deg FROM nodes n ORDER BY deg DESC LIMIT 20`).all();
            const labelDist = db.prepare('SELECT label, COUNT(*) AS cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT 10').all();
            const dbStat = fs.statSync(dbPath);
            stats = { nodes: nodeCount, edges: edgeCount, size: dbStat.size, mtime: dbStat.mtimeMs };
            report = [
              '# Monograph Knowledge Graph',
              '',
              `## Overview`,
              `- **Nodes**: ${nodeCount.toLocaleString()}`,
              `- **Edges**: ${edgeCount.toLocaleString()}`,
              `- **Last built**: ${new Date(dbStat.mtimeMs).toLocaleString()}`,
              '',
              '## Top 20 Nodes by Degree',
              ...topNodes.map((n, i) => `${String(i+1).padStart(3,' ')}. **${n.name || n.id}** \`${n.label}\` — ${n.deg} connections`),
              '',
              '## Node Type Distribution',
              ...labelDist.map(r => `- **${r.label}**: ${r.cnt}`),
            ].join('\n');
          } finally { closeDb(db); }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ exists, report, stats }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-graph
    if (req.method === 'GET' && url === '/api/monograph-graph') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        let nodes = [], edges = [];
        if (fs.existsSync(dbPath)) {
          const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const db = openDb(dbPath);
          try {
            const nodeLimit = Math.min(parseInt(qs.get('limit') || '500', 10), 5000);
            // ?labels=Section,Concept  →  fetch only those label types (no degree cutoff)
            const labelFilter = qs.get('labels') ? new Set(qs.get('labels').split(',').map(s => s.trim())) : null;
            const rawNodes = labelFilter
              ? db.prepare(`SELECT id, name, label, file_path, community_id FROM nodes WHERE label IN (${[...labelFilter].map(() => '?').join(',')}) LIMIT 5000`).all(...labelFilter)
              : db.prepare('SELECT id, name, label, file_path, community_id FROM nodes LIMIT 5000').all();
            const rawEdges = db.prepare('SELECT source_id, target_id, relation FROM edges').all();
            // Compute degree
            const degree = new Map();
            for (const n of rawNodes) degree.set(n.id, 0);
            for (const e of rawEdges) {
              if (degree.has(e.source_id)) degree.set(e.source_id, (degree.get(e.source_id) || 0) + 1);
              if (degree.has(e.target_id)) degree.set(e.target_id, (degree.get(e.target_id) || 0) + 1);
            }
            // When filtering by labels, return all matching nodes (skip degree sort+slice)
            const topNodes = labelFilter
              ? rawNodes
              : [...rawNodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, nodeLimit);
            const topIds = new Set(topNodes.map(n => n.id));
            nodes = topNodes.map(n => ({ id: n.id, label: n.name || n.id, type: n.label || 'unknown', degree: degree.get(n.id) || 0 }));
            edges = rawEdges.filter(e => topIds.has(e.source_id) && topIds.has(e.target_id)).slice(0, 2000).map(e => ({ source: e.source_id, target: e.target_id, relation: e.relation || 'REF' }));
          } finally { closeDb(db); }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ nodes, edges }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/ua-enrich
    // Trigger semantic enrichment on an existing monograph DB.
    // Imports understand graph.json if present; falls back to structural-only pass.
    if (req.method === 'POST' && url === '/api/ua-enrich') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbFilePath = path.join(d, '.monomind', 'monograph.db');

        // Check for UA graph.json first
        const uaGraphCandidates = [
          path.join(d, '.understand-anything', 'knowledge-graph.json'),
          path.join(d, '.understand-anything', 'graph.json'),
          path.join(d, '.ua', 'knowledge-graph.json'),
          path.join(d, '.ua', 'graph.json'),
        ];
        const uaGraph = uaGraphCandidates.find(p => fs.existsSync(p));
        const importScript = path.join(process.cwd(), 'scripts', 'ua-import.mjs');
        const enrichScript = path.join(process.cwd(), 'scripts', 'ua-enrich.mjs');

        res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });

        if (uaGraph && fs.existsSync(importScript)) {
          res.end(JSON.stringify({ status: 'importing', source: uaGraph }));
          const { spawn: sp } = await import('child_process');
          const child = sp(process.execPath, [importScript, uaGraph, dbFilePath], { stdio: 'ignore', detached: true, cwd: d });
          child.unref();
        } else if (fs.existsSync(enrichScript)) {
          res.end(JSON.stringify({ status: 'enriching', mode: 'structural-only' }));
          const { spawn: sp } = await import('child_process');
          const child = sp(process.execPath, [enrichScript, '--dir', d, '--db', dbFilePath, '--full'], { stdio: 'ignore', detached: true, cwd: d });
          child.unref();
        } else {
          res.end(JSON.stringify({ status: 'skipped', reason: 'No understand graph.json found. Run /monomind:understand in Claude Code first.' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/monograph-build
    if (req.method === 'POST' && url === '/api/monograph-build') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());

        res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'building', dir: d }));

        // Build via monograph in background
        const { spawn: sp } = await import('child_process');
        const script = `import { buildAsync } from '@monoes/monograph'; await buildAsync(${JSON.stringify(d)});`;
        const child = sp(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'ignore', detached: true, cwd: d });
        child.unref();
        console.log(`[graph] build started for ${d} via monograph`);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-build-docs-status
    if (req.method === 'GET' && url === '/api/monograph-build-docs-status') {
      const qs2 = new URL(req.url, 'http://localhost').searchParams;
      const d2 = path.resolve(qs2.get('dir') || projectDir || process.cwd());
      const state = buildDocsState.get(d2) || { status: 'idle' };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(state));
      return;
    }

    // -------------------------------------------------- POST /api/monograph-build-docs
    if (req.method === 'POST' && url === '/api/monograph-build-docs') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!fs.existsSync(dbPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'monograph.db not found — run BUILD GRAPH first' }));
          return;
        }

        // Reject if already running
        const existing = buildDocsState.get(d);
        if (existing && existing.status === 'pending') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: 'pending', message: 'Build already in progress' }));
          return;
        }

        const startedAt = Date.now();
        buildDocsState.set(d, { status: 'pending', sections: 0, files: 0, error: null, startedAt });
        res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'pending', dir: d }));

        // Run doc parsing in background
        (async () => {
          const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { isFileCached, updateFileCache, hashFileContent } = await import(new URL('../../../../monograph/dist/src/storage/file-cache.js', import.meta.url).href);
          const { readFileSync, readdirSync, statSync } = fs;

          const docExts = new Set(['.md', '.mdx', '.txt', '.rst']);
          const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.monomind', '__pycache__', 'vendor']);
          const docFiles = [];
          function walk(dir2, depth = 0) {
            if (depth > 12) return;
            let entries;
            try { entries = readdirSync(dir2); } catch { return; }
            for (const e of entries) {
              if (ignoreDirs.has(e) || e.startsWith('.')) continue;
              const full = path.join(dir2, e);
              let st;
              try { st = statSync(full); } catch { continue; }
              if (st.isDirectory()) { walk(full, depth + 1); }
              else if (docExts.has(path.extname(e).toLowerCase()) && st.size < 600000) docFiles.push(full);
            }
          }
          walk(d);

          const db = openDb(dbPath);
          try {
            const insertNode = db.prepare(`INSERT OR REPLACE INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, language, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`);
            const insertEdge = db.prepare(`INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, weight) VALUES (?, ?, ?, ?, 'EXTRACTED', 1.0, 1.0)`);

            const insertAll = db.transaction((nodes, edges) => {
              for (const n of nodes) {
                try { insertNode.run(n.id, n.label, n.name, n.norm_label, n.file_path, n.start_line, n.end_line, n.language); } catch {}
              }
              for (const e of edges) { try { insertEdge.run(e.id, e.src, e.dst, e.rel); } catch {} }
            });

            const normTitle = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

            let totalSections = 0;
            let skipped = 0;
            for (const filePath of docFiles) {
              let content;
              try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }

              // Skip unchanged files using file cache
              let isCached = false;
              let contentHash = '';
              try {
                contentHash = hashFileContent(content);
                isCached = isFileCached(db, filePath, contentHash);
              } catch {}
              if (isCached) { skipped++; continue; }
              const relPath = path.relative(d, filePath);
              const ext = path.extname(filePath).slice(1).toLowerCase();
              const fileId = 'doc:' + relPath;
              const lineCount = content.split('\n').length;

              const nodes = [{ id: fileId, label: 'File', name: relPath, norm_label: normTitle(relPath), file_path: relPath, start_line: 1, end_line: lineCount, language: ext }];
              const edges = [];
              const lines = content.split('\n');
              const sectionStack = [{ id: fileId, depth: 0 }];
              let inCodeBlock = false;
              let codeBlockLang = null;

              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Track fenced code blocks — don't parse headings inside them
                const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)$/);
                if (fenceMatch) {
                  if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeBlockLang = fenceMatch[1].trim() || null;
                    if (codeBlockLang) {
                      const cId = 'concept:lang:' + codeBlockLang.toLowerCase();
                      if (!nodes.find(n => n.id === cId)) {
                        nodes.push({ id: cId, label: 'Concept', name: codeBlockLang, norm_label: normTitle(codeBlockLang), file_path: null, start_line: 0, end_line: 0, language: null });
                      }
                      const curSec = sectionStack[sectionStack.length - 1].id;
                      edges.push({ id: 'e:' + curSec + ':' + cId + ':code', src: curSec, dst: cId, rel: 'TAGGED_AS' });
                    }
                  } else { inCodeBlock = false; codeBlockLang = null; }
                  continue;
                }
                if (inCodeBlock) continue;

                // ATX headings: # Title
                const hMatch = line.match(/^(#{1,6})\s+(.+)/);
                if (hMatch) {
                  const depth = hMatch[1].length;
                  const title = hMatch[2].trim().replace(/\s+#+\s*$/, '').trim();
                  const secId = 'sec:' + relPath + ':' + (i + 1);
                  nodes.push({ id: secId, label: 'Section', name: title, norm_label: normTitle(title), file_path: relPath, start_line: i + 1, end_line: i + 1, language: ext });
                  totalSections++;
                  while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].depth >= depth) sectionStack.pop();
                  const parentId = sectionStack[sectionStack.length - 1].id;
                  edges.push({ id: 'e:' + secId + ':' + parentId + ':parent', src: parentId, dst: secId, rel: 'DEFINES' });
                  sectionStack.push({ id: secId, depth });
                  continue;
                }

                // RST-style headings: line followed by ===, ---, ~~~, ^^^, etc.
                if (i + 1 < lines.length && lines[i + 1].match(/^[=\-~^"'`#*+!]{3,}\s*$/) && line.trim().length > 0 && line.trim().length <= lines[i + 1].trim().length + 2) {
                  const underlineChar = lines[i + 1].trim()[0];
                  const rstDepth = '=-~^"\'`#*+!'.indexOf(underlineChar) + 1 || 3;
                  const title = line.trim();
                  const secId = 'sec:' + relPath + ':' + (i + 1);
                  nodes.push({ id: secId, label: 'Section', name: title, norm_label: normTitle(title), file_path: relPath, start_line: i + 1, end_line: i + 1, language: ext });
                  totalSections++;
                  const depth = Math.min(6, Math.ceil(rstDepth / 2));
                  while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].depth >= depth) sectionStack.pop();
                  const parentId = sectionStack[sectionStack.length - 1].id;
                  edges.push({ id: 'e:' + secId + ':' + parentId + ':parent', src: parentId, dst: secId, rel: 'DEFINES' });
                  sectionStack.push({ id: secId, depth });
                  i++; // skip underline line
                  continue;
                }

                // #hashtag concepts (skip markdown headings already matched)
                const tags = line.match(/#([a-zA-Z][a-zA-Z0-9_-]{2,})/g);
                if (tags) {
                  for (const tag of tags) {
                    const concept = tag.slice(1);
                    const cId = 'concept:tag:' + concept.toLowerCase();
                    if (!nodes.find(n => n.id === cId)) {
                      nodes.push({ id: cId, label: 'Concept', name: concept, norm_label: normTitle(concept), file_path: null, start_line: 0, end_line: 0, language: null });
                    }
                    const curSec = sectionStack[sectionStack.length - 1].id;
                    edges.push({ id: 'e:' + curSec + ':' + cId + ':tag', src: curSec, dst: cId, rel: 'TAGGED_AS' });
                  }
                }
              }

              try {
                insertAll(nodes, edges);
                // Update file cache so we skip unchanged files next run
                try {
                  updateFileCache(db, { filePath, contentHash, lastParsed: Date.now(), nodeCount: nodes.length, edgeCount: edges.length });
                } catch {}
              } catch (e) { console.error('[docs-build] error inserting', relPath, e.message); }
            }
            console.log(`[docs-build] indexed ${docFiles.length - skipped} docs (${skipped} cached), ${totalSections} sections → ${dbPath}`);
            buildDocsState.set(d, { status: 'done', sections: totalSections, files: docFiles.length - skipped, cached: skipped, error: null, startedAt, completedAt: Date.now() });
          } finally { closeDb(db); }
        })().catch(e => {
          console.error('[docs-build] fatal:', e.message);
          buildDocsState.set(d, { status: 'error', sections: 0, files: 0, error: e.message, startedAt, completedAt: Date.now() });
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-content
    // Returns actual file content for a node (properties.content or file slice)
    if (req.method === 'GET' && url === '/api/monograph-content') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const id = qs.get('id') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?id=' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Graph not built' })); return; }
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const db = openDb(dbPath);
        let content = '', filePath = '', startLine = 0, endLine = 0, language = '', name = '', type = '';
        try {
          const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
          if (!node) { res.writeHead(404); res.end(JSON.stringify({ error: 'Node not found' })); return; }
          name = node.name || id;
          type = node.label || 'Unknown';
          filePath = node.file_path || '';
          startLine = node.start_line || 0;
          endLine = node.end_line || 0;
          language = node.language || '';
          // Try properties.content first (from official monograph pipeline)
          if (node.properties) {
            try {
              const props = JSON.parse(node.properties);
              if (props.content && props.content.trim()) { content = props.content; }
            } catch {}
          }
          // Fallback: read from actual file
          if (!content && filePath) {
            const absPath = path.isAbsolute(filePath) ? filePath : path.join(d, filePath);
            try {
              const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
              const sl = Math.max(0, (startLine || 1) - 1);
              const el = Math.min(lines.length, (endLine || startLine || lines.length) + 5);
              content = lines.slice(sl, Math.min(el, sl + 120)).join('\n');
            } catch {}
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ content, filePath, startLine, endLine, language, name, type }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-fts
    // Full-text search with content snippets — powers the wiki search box
    if (req.method === 'GET' && url === '/api/monograph-fts') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        // Cap ?q= to prevent DoS via megabyte FTS query strings.
        const q = (qs.get('q') || '').trim().slice(0, 4096);
        const limit = Math.min(100, parseInt(qs.get('limit') || '50', 10));
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q=' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ nodes: [] })); return; }
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
        const db = openDb(dbPath);
        let nodes = [];
        try {
          const hits = ftsSearch(db, q, limit);
          nodes = hits.map(h => {
            let snippet = '';
            if (h.properties) { try { const p = JSON.parse(h.properties); snippet = (p.content || '').slice(0, 200); } catch {} }
            return { id: h.id, label: h.name, type: h.label, degree: 0, filePath: h.filePath || h.file_path, startLine: h.startLine || h.start_line, snippet };
          });
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ nodes }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-related
    // BFS from a node — returns node IDs sorted by graph distance (for re-ranking)
    if (req.method === 'GET' && url === '/api/monograph-related') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const id = qs.get('id') || '';
        const limit = Math.min(200, parseInt(qs.get('limit') || '60', 10));
        const maxDepth = Math.min(4, parseInt(qs.get('depth') || '3', 10));
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!id || !fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ related: [] })); return; }
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const db = openDb(dbPath);
        const related = [];
        try {
          const visited = new Set([id]);
          let frontier = [id];
          for (let depth = 1; depth <= maxDepth && frontier.length > 0 && related.length < limit; depth++) {
            const next = [];
            for (const nodeId of frontier) {
              const rows = db.prepare(`SELECT DISTINCT target_id as nid FROM edges WHERE source_id=? UNION SELECT DISTINCT source_id as nid FROM edges WHERE target_id=? LIMIT 30`).all(nodeId, nodeId);
              for (const r of rows) {
                if (!visited.has(r.nid)) {
                  visited.add(r.nid);
                  next.push(r.nid);
                  related.push({ id: r.nid, distance: depth });
                  if (related.length >= limit) break;
                }
              }
              if (related.length >= limit) break;
            }
            frontier = next;
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ related }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-ai-context
    // Builds a rich AI context bundle for a node: content + 1-hop neighbors
    if (req.method === 'GET' && url === '/api/monograph-ai-context') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const id = qs.get('id') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!id || !fs.existsSync(dbPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const db = openDb(dbPath);
        let result = { node: null, content: '', neighbors: [], markdown: '' };
        try {
          const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
          if (!node) { res.writeHead(404); res.end(JSON.stringify({ error: 'Node not found' })); return; }
          result.node = { id: node.id, name: node.name, type: node.label, filePath: node.file_path, startLine: node.start_line, endLine: node.end_line };
          // Get content
          let content = '';
          if (node.properties) { try { const p = JSON.parse(node.properties); content = p.content || ''; } catch {} }
          if (!content && node.file_path) {
            const absPath = path.isAbsolute(node.file_path) ? node.file_path : path.join(d, node.file_path);
            try {
              const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
              const sl = Math.max(0, (node.start_line || 1) - 1);
              const el = Math.min(lines.length, (node.end_line || node.start_line || lines.length) + 5);
              content = lines.slice(sl, Math.min(el, sl + 80)).join('\n');
            } catch {}
          }
          result.content = content;
          // Get 1-hop neighbors
          const outEdges = db.prepare('SELECT e.relation, n.id, n.name, n.label, n.file_path FROM edges e JOIN nodes n ON n.id=e.target_id WHERE e.source_id=? LIMIT 20').all(id);
          const inEdges = db.prepare('SELECT e.relation, n.id, n.name, n.label, n.file_path FROM edges e JOIN nodes n ON n.id=e.source_id WHERE e.target_id=? LIMIT 20').all(id);
          result.neighbors = [
            ...outEdges.map(e => ({ direction: 'out', relation: e.relation, id: e.id, name: e.name, type: e.label, filePath: e.file_path })),
            ...inEdges.map(e => ({ direction: 'in', relation: e.relation, id: e.id, name: e.name, type: e.label, filePath: e.file_path })),
          ];
          // Build markdown for clipboard/AI
          const lines2 = [];
          lines2.push(`# ${node.name} [${node.label}]`);
          if (node.file_path) lines2.push(`**File:** \`${node.file_path}\`${node.start_line ? ` (line ${node.start_line})` : ''}`);
          if (content) lines2.push(`\n\`\`\`${node.language || ''}\n${content.slice(0, 3000)}\n\`\`\``);
          if (outEdges.length) {
            lines2.push(`\n**Depends on (${outEdges.length}):**`);
            outEdges.forEach(e => lines2.push(`- ${e.relation} → ${e.name} [${e.label}]${e.file_path ? ' `' + e.file_path + '`' : ''}`));
          }
          if (inEdges.length) {
            lines2.push(`\n**Used by (${inEdges.length}):**`);
            inEdges.forEach(e => lines2.push(`- ${e.relation} ← ${e.name} [${e.label}]${e.file_path ? ' `' + e.file_path + '`' : ''}`));
          }
          result.markdown = lines2.join('\n');
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-query
    if (req.method === 'GET' && url === '/api/monograph-query') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const q = (qs.get('q') || '').trim().slice(0, 4096);
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q= parameter' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, result: 'Graph not built yet. Run: monomind monograph build' })); return; }
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
        const db = openDb(dbPath);
        let result = '';
        try {
          const hits = ftsSearch(db, q, 20);
          if (!hits.length) {
            result = `No matches found for: "${q}"`;
          } else {
            result = hits.map((h, i) => `${String(i+1).padStart(3,' ')}. ${h.name} [${h.normLabel}]${h.filePath ? '\n     ' + h.filePath : ''}`).join('\n');
            // Show outgoing edges for top hit
            const topHit = hits[0];
            const neighbors = db.prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 10').all(topHit.id);
            if (neighbors.length) {
              result += `\n\n── ${topHit.name} references:\n` + neighbors.map(n => `   ${n.relation} → ${n.target_id.split('/').pop() || n.target_id}`).join('\n');
            }
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, query: q, result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-explain
    if (req.method === 'GET' && url === '/api/monograph-explain') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const nodeQ = (qs.get('node') || '').trim().slice(0, 4096);
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!nodeQ) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?node= parameter' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, explanation: 'Graph not built yet. Run: monomind monograph build' })); return; }
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
        const db = openDb(dbPath);
        let explanation = '';
        try {
          let nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(nodeQ) || db.prepare('SELECT * FROM nodes WHERE name=?').get(nodeQ);
          if (!nd) { const hits = ftsSearch(db, nodeQ, 1); if (hits[0]) nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(hits[0].id); }
          if (!nd) {
            explanation = `No node found matching: "${nodeQ}"`;
          } else {
            const outEdges = db.prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 20').all(nd.id);
            const inEdges = db.prepare('SELECT source_id, relation FROM edges WHERE target_id=? LIMIT 20').all(nd.id);
            explanation = [
              `## ${nd.name} [${nd.label}]`,
              nd.file_path ? `File: ${nd.file_path}${nd.start_line ? ':' + nd.start_line : ''}` : '',
              nd.language ? `Language: ${nd.language}` : '',
              nd.is_exported ? 'Exported: yes' : 'Exported: no',
              '',
              outEdges.length ? `References (${outEdges.length}):\n` + outEdges.map(e => `  ${e.relation} → ${e.target_id.split('/').pop() || e.target_id}`).join('\n') : 'No outgoing references.',
              inEdges.length ? `\nReferenced by (${inEdges.length}):\n` + inEdges.map(e => `  ${e.source_id.split('/').pop() || e.source_id} [${e.relation}]`).join('\n') : '',
            ].filter(Boolean).join('\n');
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, node: nodeQ, explanation }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-path
    if (req.method === 'GET' && url === '/api/monograph-path') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const from = (qs.get('from') || '').trim().slice(0, 4096);
        const to = (qs.get('to') || '').trim().slice(0, 4096);
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!from || !to) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?from= and ?to= parameters' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, path: 'Graph not built yet.' })); return; }
        // Import only graphology-free storage modules to avoid broken graphology dep
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
        // SQL-based BFS for shortest path (avoids graphology)
        const getShortestPath = (db, fromId, toId, maxDepth = 6) => {
          if (fromId === toId) return [fromId];
          const visited = new Set([fromId]);
          let frontier = [[fromId]];
          for (let depth = 0; depth < maxDepth; depth++) {
            const next = [];
            for (const chain of frontier) {
              const cur = chain[chain.length - 1];
              const neighbors = db.prepare('SELECT target_id AS id FROM edges WHERE source_id=? UNION SELECT source_id AS id FROM edges WHERE target_id=?').all(cur, cur);
              for (const { id } of neighbors) {
                if (!visited.has(id)) {
                  const newChain = [...chain, id];
                  if (id === toId) return newChain;
                  visited.add(id);
                  next.push(newChain);
                }
              }
            }
            if (!next.length) break;
            frontier = next;
          }
          return null;
        };
        const db = openDb(dbPath);
        let pathResult = '';
        try {
          const resolveId = (q) => {
            const direct = db.prepare('SELECT id FROM nodes WHERE id=? OR name=?').get(q, q);
            if (direct) return direct.id;
            const hits = ftsSearch(db, q, 1);
            return hits[0]?.id || q;
          };
          const fromId = resolveId(from);
          const toId = resolveId(to);
          const p = getShortestPath(db, fromId, toId);
          if (!p || !p.length) {
            pathResult = `No path found between "${from}" and "${to}"`;
          } else {
            const names = p.map(id => { const n = db.prepare('SELECT name FROM nodes WHERE id=?').get(id); return n ? n.name : id.split('/').pop() || id; });
            pathResult = names.join(' → ') + `  (${p.length - 1} hop${p.length !== 2 ? 's' : ''})`;
          }
        } finally { closeDb(db); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, from, to, path: pathResult }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/monograph-watch-status
    if (req.method === 'GET' && url === '/api/monograph-watch-status') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
        let running = false, pid = null;
        try {
          pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          running = true;
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ running, pid }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/monograph-watch-toggle
    if (req.method === 'POST' && url === '/api/monograph-watch-toggle') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
        let wasRunning = false;
        try {
          const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          wasRunning = true;
          process.kill(pid, 'SIGTERM');
          try { fs.unlinkSync(pidPath); } catch {}
        } catch {}

        if (wasRunning) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ running: false, action: 'stopped' }));
        } else {
          const { spawn: sp } = await import('child_process');
          const child = sp(process.execPath, [process.argv[1], 'monograph', 'watch'], { stdio: 'ignore', detached: true, cwd: d, env: process.env });
          child.unref();
          try { fs.mkdirSync(path.join(d, '.monomind'), { recursive: true }); } catch {}
          try { fs.writeFileSync(pidPath, String(child.pid)); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ running: true, pid: child.pid, action: 'started' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- POST /api/mcp/call
    if (req.method === 'POST' && url === '/api/mcp/call') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2097152) { req.destroy(); return; } });
      req.on('end', async () => {
        const json = res => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); };
        const ok = (data) => { json(res); res.end(JSON.stringify({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })); };
        const err = (msg) => { json(res); res.end(JSON.stringify({ error: msg })); };
        try {
          const { tool, input = {}, args = {} } = JSON.parse(body);
          const qs2 = new URL(req.url, 'http://localhost').searchParams;
          // dir can come from: URL query string, body.args.dir, body.input.dir, or server default
          const dir2 = qs2.get('dir') || args.dir || input.dir || projectDir;
          const d2 = path.resolve(dir2 || process.cwd());
          const dbPath2 = path.join(d2, '.monomind', 'monograph.db');
          if (!fs.existsSync(dbPath2)) { err('monograph.db not found — run monograph build first'); return; }
          // Import only graphology-free storage modules to avoid broken graphology dep
          const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
          const { countNodes } = await import(new URL('../../../../monograph/dist/src/storage/node-store.js', import.meta.url).href);
          const { countEdges } = await import(new URL('../../../../monograph/dist/src/storage/edge-store.js', import.meta.url).href);
          const getShortestPath = (db, fromId, toId, maxDepth = 6) => {
            if (fromId === toId) return [fromId];
            const visited = new Set([fromId]);
            let frontier = [[fromId]];
            for (let depth = 0; depth < maxDepth; depth++) {
              const next = [];
              for (const chain of frontier) {
                const cur = chain[chain.length - 1];
                const neighbors = db.prepare('SELECT target_id AS id FROM edges WHERE source_id=? UNION SELECT source_id AS id FROM edges WHERE target_id=?').all(cur, cur);
                for (const { id } of neighbors) {
                  if (!visited.has(id)) {
                    const newChain = [...chain, id];
                    if (id === toId) return newChain;
                    visited.add(id);
                    next.push(newChain);
                  }
                }
              }
              if (!next.length) break;
              frontier = next;
            }
            return null;
          };
          const db2 = openDb(dbPath2);
          try {
            if (tool === 'monograph_stats') {
              const n = countNodes(db2), e = countEdges(db2);
              ok(`nodes: ${n}\nedges: ${e}`);
            } else if (tool === 'monograph_cypher') {
              // Translate basic MATCH (n:Label) queries to SQL
              const q = (String(input.query || '')).trim().slice(0, 4096);
              const labelMatch = q.match(/MATCH\s+\(n:(\w+)\)/i);
              if (labelMatch) {
                const label = labelMatch[1];
                const rows = db2.prepare('SELECT name FROM nodes WHERE label = ? LIMIT 5000').all(label);
                ok(rows.map(r => r.name).join('\n'));
              } else {
                ok('Cypher: unsupported query pattern');
              }
            } else if (tool === 'monograph_cohesion') {
              const limit = input.limit || 30;
              // Check if community_id is populated
              const hasCommunities = db2.prepare('SELECT COUNT(*) as c FROM nodes WHERE community_id IS NOT NULL').get().c > 0;
              if (hasCommunities) {
                const rows = db2.prepare('SELECT community_id, COUNT(*) as size FROM nodes GROUP BY community_id ORDER BY size DESC LIMIT ?').all(limit);
                ok(rows.map(r => `community ${r.community_id}: ${r.size} nodes`).join('\n'));
              } else {
                // Fallback: group by type (label)
                const rows = db2.prepare('SELECT label, COUNT(*) as cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT ?').all(limit);
                const total = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
                const lines = rows.map(r => {
                  const pct = ((r.cnt / total) * 100).toFixed(1);
                  const bar = '█'.repeat(Math.round(pct / 3));
                  return `${(r.label || 'unknown').padEnd(12)} ${r.cnt.toString().padStart(6)} nodes  (${pct}%)  ${bar}`;
                });
                ok(`Type Distribution (community clustering not yet run)\n${'─'.repeat(50)}\n${lines.join('\n')}`);
              }
            } else if (tool === 'monograph_bridge') {
              const limit = input.limit || 20;
              // Find hub nodes that connect many different directories (cross-module connectors)
              const rows = db2.prepare(`
                SELECT n.name, n.label, n.file_path,
                  COUNT(DISTINCT CASE WHEN e.source_id = n.id THEN n2.file_path ELSE NULL END) +
                  COUNT(DISTINCT CASE WHEN e.target_id = n.id THEN n2.file_path ELSE NULL END) as cross_file_count,
                  (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) as total_degree
                FROM nodes n
                JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
                JOIN nodes n2 ON (e.source_id = n2.id OR e.target_id = n2.id) AND n2.id != n.id
                GROUP BY n.id
                HAVING cross_file_count > 2
                ORDER BY cross_file_count DESC, total_degree DESC
                LIMIT ?`).all(limit);
              if (!rows.length) {
                ok('No cross-module bridge nodes found in top results. Try running monograph build to index more files.');
              } else {
                const lines = rows.map(r =>
                  `${r.name} (${r.label})\n  → connects ${r.cross_file_count} files, degree ${r.total_degree}\n  ${r.file_path || '?'}`
                );
                ok(`Cross-Module Bridge Nodes (${rows.length})\n${'─'.repeat(50)}\n${lines.join('\n\n')}`);
              }
            } else if (tool === 'monograph_detect_changes') {
              const { execSync } = await import('child_process');
              let changed = '';
              try { changed = execSync('git diff --name-only HEAD', { cwd: d2, encoding: 'utf-8' }); } catch { changed = '(git not available)'; }
              ok(changed.trim() || 'No changed files detected');
            } else if (tool === 'monograph_diff') {
              ok('Graph diff: compare two snapshots using monograph snapshot + monograph diff commands');
            } else if (tool === 'monograph_rename') {
              // Cap sym to prevent O(n) FTS scan DoS via oversized query string.
              const sym = String(input.symbolName || '').slice(0, 4096);
              if (!sym) { ok('Provide symbolName to rename'); return; }
              const hits = ftsSearch(db2, sym, 20);
              ok(`Found ${hits.length} occurrences of "${sym}":\n` + hits.map(h => `  ${h.filePath || '?'}:${h.startLine || '?'} — ${h.name}`).join('\n'));
            } else if (tool === 'monograph_impact') {
              const target = String(input.target || '').slice(0, 4096);
              const dir3 = input.direction || 'both';
              const depth = input.maxDepth || 4;
              const hits = ftsSearch(db2, target, 5);
              if (!hits.length) { ok(`Node not found: ${target}`); return; }
              const nodeId = hits[0].id;
              const visited = new Set([nodeId]);
              const frontier = [nodeId];
              const results = [];
              for (let d3 = 0; d3 < depth && frontier.length; d3++) {
                const next = [];
                for (const id of frontier) {
                  const outgoing = dir3 !== 'upstream' ? db2.prepare('SELECT target_id, relation FROM edges WHERE source_id = ?').all(id) : [];
                  const incoming = dir3 !== 'downstream' ? db2.prepare('SELECT source_id as target_id, relation FROM edges WHERE target_id = ?').all(id) : [];
                  for (const e of [...outgoing, ...incoming]) {
                    if (!visited.has(e.target_id)) {
                      visited.add(e.target_id);
                      next.push(e.target_id);
                      const n3 = db2.prepare('SELECT name, label FROM nodes WHERE id = ?').get(e.target_id);
                      if (n3) results.push(`  [hop ${d3+1}] ${n3.name} (${n3.label}) via ${e.relation}`);
                    }
                  }
                }
                frontier.length = 0; frontier.push(...next);
              }
              ok(`Impact of "${hits[0].name}" (${dir3}, depth=${depth}):\n` + (results.join('\n') || '  (no dependencies found)'));
            } else if (tool === 'monograph_context') {
              const id = String(input.id || '').slice(0, 4096);
              const hits = ftsSearch(db2, id, 5);
              if (!hits.length) { ok(`Node not found: ${id}`); return; }
              const node = hits[0];
              const outEdges = db2.prepare('SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20').all(node.id);
              const inEdges = db2.prepare('SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ? LIMIT 20').all(node.id);
              ok(`# ${node.name} (${node.label})\nFile: ${node.filePath || '?'}\n\n**Imports / depends on (${outEdges.length}):**\n${outEdges.map(e => `  → ${e.name} [${e.relation}]`).join('\n') || '  (none)'}\n\n**Used by / depended on by (${inEdges.length}):**\n${inEdges.map(e => `  ← ${e.name} [${e.relation}]`).join('\n') || '  (none)'}`);
            } else if (tool === 'monograph_query' || tool === 'monograph_suggest') {
              const q2 = String(input.query || input.task || '').slice(0, 4096);
              const hits2 = ftsSearch(db2, q2, 20);
              ok(hits2.map(h => `${h.name} (${h.label}) — ${h.filePath || '?'}:${h.startLine || '?'}`).join('\n') || 'No results');

            } else if (tool === 'monograph_unlinked_refs') {
              const limit = input.limit || 50;
              const rows = db2.prepare(`SELECT n.name, n.label, n.file_path FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Variable','Interface','Method','Module') ORDER BY n.name LIMIT ?`).all(limit);
              if (!rows.length) { ok('No unlinked symbols found — all exports appear to be referenced.'); }
              else { ok(`Unlinked Symbols (${rows.length}) — potentially unused exports:\n${'─'.repeat(50)}\n${rows.map(r => `  ${r.name} (${r.label})\n    ${r.file_path || '?'}`).join('\n\n')}`); }

            } else if (tool === 'monograph_reachability') {
              const limit = input.limit || 30;
              const unreachable = db2.prepare(`SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as out_deg FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label = 'File' ORDER BY out_deg DESC LIMIT ?`).all(limit);
              const total = db2.prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'").get().c;
              if (!unreachable.length) { ok(`All ${total} files are reachable from at least one other file.`); }
              else { ok(`Unreachable Files (${unreachable.length} of ${total} total):\n${'─'.repeat(50)}\n${unreachable.map(r => `  ${r.name}${r.out_deg ? ` (imports ${r.out_deg} others)` : ''}\n    ${r.file_path || '?'}`).join('\n\n')}`); }

            } else if (tool === 'monograph_boundary_check') {
              const limit = input.limit || 40;
              const rows = db2.prepare(`SELECT n1.file_path as src, n2.file_path as dst, e.relation, COUNT(*) as cnt FROM edges e JOIN nodes n1 ON n1.id = e.source_id JOIN nodes n2 ON n2.id = e.target_id WHERE n1.file_path IS NOT NULL AND n2.file_path IS NOT NULL AND n1.file_path != n2.file_path GROUP BY n1.file_path, n2.file_path ORDER BY cnt DESC LIMIT ?`).all(limit);
              const suspicious = rows.filter(r => { const s = (r.src||'').toLowerCase(), t = (r.dst||'').toLowerCase(); return (s.includes('test') && !t.includes('test')) || (s.includes('spec') && !t.includes('spec')) || (s.includes('/ui/') && t.includes('/db/')) || (s.includes('/view') && t.includes('/model')); });
              if (!suspicious.length) { ok(`Boundary check: ${rows.length} cross-file edge groups — no obvious violations.\nTop connections:\n${rows.slice(0,10).map(r => `  ${r.src} → ${r.dst} [${r.cnt}x]`).join('\n')}`); }
              else { ok(`Boundary Violations (${suspicious.length} suspicious):\n${'─'.repeat(50)}\n${suspicious.map(r => `  ⚠ ${r.src}\n    → ${r.dst}  [${r.cnt} edges]`).join('\n\n')}`); }

            } else if (tool === 'monograph_regression_check' || tool === 'monograph_baseline_compare') {
              const n = countNodes(db2), e = countEdges(db2);
              const bPath = path.join(d2, '.monomind', 'monograph-baseline.json');
              if (!fs.existsSync(bPath)) {
                fs.writeFileSync(bPath, JSON.stringify({ nodes: n, edges: e, savedAt: new Date().toISOString() }), 'utf-8');
                ok(`Baseline saved (${n} nodes, ${e} edges). Run again to compare.`);
              } else {
                const base = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
                const dn = n - base.nodes, de = e - base.edges;
                const sign = v => v > 0 ? `+${v}` : String(v);
                ok(`Comparison vs baseline (${base.savedAt || 'unknown'}):\n${'─'.repeat(50)}\n  Nodes: ${base.nodes} → ${n} (${sign(dn)})\n  Edges: ${base.edges} → ${e} (${sign(de)})\n\n${dn === 0 && de === 0 ? '✓ No structural regressions detected.' : '⚠ Graph has changed since baseline.'}`);
              }

            } else if (tool === 'monograph_clone_detect' || tool === 'monograph_similar_files') {
              const limit = input.limit || 20;
              const fileNodes = db2.prepare("SELECT id, name, file_path FROM nodes WHERE label = 'File' LIMIT 300").all();
              const deps = {};
              for (const f of fileNodes) { deps[f.id] = { name: f.name, set: new Set(db2.prepare('SELECT target_id FROM edges WHERE source_id = ?').all(f.id).map(r => r.target_id)) }; }
              const keys = Object.keys(deps), pairs = [];
              for (let i = 0; i < Math.min(keys.length, 150); i++) {
                for (let j = i + 1; j < Math.min(keys.length, 150); j++) {
                  const a = deps[keys[i]], b = deps[keys[j]];
                  if (!a.set.size && !b.set.size) continue;
                  const inter = [...a.set].filter(x => b.set.has(x)).length;
                  const union = new Set([...a.set, ...b.set]).size;
                  const jac = union ? inter / union : 0;
                  if (jac > 0.5) pairs.push({ a: a.name, b: b.name, jac });
                }
              }
              pairs.sort((x, y) => y.jac - x.jac);
              const top = pairs.slice(0, limit);
              if (!top.length) { ok('No similar file pairs found (Jaccard threshold: 0.5).'); }
              else { ok(`Similar File Pairs (${top.length}, by import pattern):\n${'─'.repeat(50)}\n${top.map(p => `  ${(p.jac*100).toFixed(0)}% similar\n    ${p.a}\n    ${p.b}`).join('\n\n')}`); }

            } else if (tool === 'monograph_mirrored_dirs') {
              const fileNodes = db2.prepare("SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL").all();
              const dirFiles = {};
              for (const f of fileNodes) { const dir = path.dirname(f.file_path), base = path.basename(f.file_path); if (!dirFiles[dir]) dirFiles[dir] = new Set(); dirFiles[dir].add(base); }
              const dirs = Object.keys(dirFiles), pairs = [];
              for (let i = 0; i < dirs.length; i++) {
                for (let j = i + 1; j < dirs.length; j++) {
                  const a = dirFiles[dirs[i]], b = dirFiles[dirs[j]];
                  const inter = [...a].filter(x => b.has(x)).length;
                  const union = new Set([...a, ...b]).size;
                  const jac = union ? inter / union : 0;
                  if (jac >= 0.5 && inter >= 2) pairs.push({ a: dirs[i], b: dirs[j], overlap: inter, jac });
                }
              }
              pairs.sort((x, y) => y.jac - x.jac);
              if (!pairs.length) { ok('No mirrored directory pairs detected (Jaccard ≥ 0.5, min 2 shared files).'); }
              else { ok(`Mirrored Directories (${pairs.length} pairs):\n${'─'.repeat(50)}\n${pairs.slice(0,20).map(p => `  ${(p.jac*100).toFixed(0)}% overlap (${p.overlap} shared files)\n    ${p.a}\n    ${p.b}`).join('\n\n')}`); }

            } else if (tool === 'monograph_health_score' || tool === 'monograph_vital_signs_snapshot') {
              const n = countNodes(db2), e = countEdges(db2);
              const dead = db2.prepare("SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Method')").get().c;
              const hubs = db2.prepare('SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*) > 20)').get().c;
              const density = n > 1 ? (2 * e / (n * (n - 1))).toFixed(4) : '0';
              const deadRatio = n ? (dead / n * 100).toFixed(1) : '0';
              const score = Math.max(0, Math.min(100, 100 - Math.min(30, parseFloat(deadRatio) * 0.5) - Math.min(20, hubs * 2))).toFixed(0);
              const status = parseInt(score) >= 70 ? '✓ OK' : parseInt(score) >= 40 ? '⚠ WARNING' : '✗ CRITICAL';
              ok(`Vital Signs — ${new Date().toISOString()}\n${'─'.repeat(50)}\n  Health Score:  ${score}/100  ${status}\n  Nodes:         ${n}\n  Edges:         ${e}\n  Density:       ${density}\n  Dead symbols:  ${dead} (${deadRatio}%)\n  Hub nodes:     ${hubs} nodes with >20 edges`);

            } else if (tool === 'monograph_health_trend') {
              const bPath = path.join(d2, '.monomind', 'monograph-baseline.json');
              if (!fs.existsSync(bPath)) { ok('No trend data yet. Run "Health Score" or "Regression Check" first to save a baseline.'); }
              else {
                const base = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
                const n = countNodes(db2), e = countEdges(db2);
                const dn = n - base.nodes, de = e - base.edges;
                const sign = v => v > 0 ? `+${v}` : String(v);
                ok(`Health Trend (vs ${base.savedAt || 'unknown'}):\n${'─'.repeat(50)}\n  Nodes: ${base.nodes} → ${n} (${sign(dn)})\n  Edges: ${base.edges} → ${e} (${sign(de)})\n  Trend: ${dn === 0 && de === 0 ? 'stable' : dn > 0 ? 'growing' : 'shrinking'}`);
              }

            } else if (tool === 'monograph_hotspots') {
              const limit = input.limit || 20;
              const rows = db2.prepare(`SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) as degree, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as fan_out, (SELECT COUNT(*) FROM edges WHERE target_id = n.id) as fan_in FROM nodes n WHERE n.label = 'File' ORDER BY degree DESC LIMIT ?`).all(limit);
              if (!rows.length) { ok('No file hotspots found.'); }
              else { ok(`Hotspot Files (top ${rows.length} by degree):\n${'─'.repeat(50)}\n${rows.map((r,i) => `  ${i+1}. ${r.name}  [degree ${r.degree}: ↑${r.fan_in} in, ↓${r.fan_out} out]\n     ${r.file_path || '?'}`).join('\n')}`); }

            } else if (tool === 'monograph_maintainability') {
              const limit = input.limit || 25;
              const rows = db2.prepare(`SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as fan_out, (SELECT COUNT(*) FROM edges WHERE target_id = n.id) as fan_in FROM nodes n WHERE n.label = 'File' ORDER BY fan_out DESC LIMIT ?`).all(limit);
              if (!rows.length) { ok('No file data for maintainability analysis.'); }
              else {
                const maxOut = Math.max(...rows.map(r => r.fan_out), 1);
                const lines = rows.map(r => { const mi = Math.max(0, 100 - (r.fan_out / maxOut) * 60 - (r.fan_in > 10 ? 20 : 0)).toFixed(0); return `  ${parseInt(mi) >= 70 ? '✓' : parseInt(mi) >= 40 ? '⚠' : '✗'} MI:${mi.padStart(3)}  out:${String(r.fan_out).padStart(4)}  in:${String(r.fan_in).padStart(4)}  ${r.name}`; });
                ok(`Maintainability Index (estimated from fan-out/fan-in):\n${'─'.repeat(60)}\n${lines.join('\n')}`);
              }

            } else if (tool === 'monograph_complexity' || tool === 'monograph_crap_score') {
              const limit = input.limit || 25;
              const rows = db2.prepare(`SELECT n.name, n.label, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as out_deg FROM nodes n WHERE n.label IN ('Function','Method','Class') ORDER BY out_deg DESC LIMIT ?`).all(limit);
              if (!rows.length) { ok('No function/method nodes found. Build the graph first.'); }
              else {
                const isCrap = tool === 'monograph_crap_score';
                const header = isCrap ? 'CRAP Score proxy (degree² — lower is better)' : 'Complexity by Out-Degree';
                ok(`${header}:\n${'─'.repeat(50)}\n${rows.map(r => `  ${r.name} (${r.label})  ${isCrap ? 'CRAP' : 'complexity'}: ${isCrap ? Math.pow(r.out_deg,2) : r.out_deg}\n    ${r.file_path || '?'}`).join('\n')}`);
              }

            } else if (tool === 'monograph_risk_profile') {
              const n = countNodes(db2), e = countEdges(db2);
              const dead = db2.prepare("SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Method')").get().c;
              const hubs = db2.prepare('SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*) > 15)').get().c;
              const files = db2.prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'").get().c;
              const orphans = db2.prepare("SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label = 'File'").get().c;
              const risks = [];
              if (dead > 10) risks.push(`  HIGH   Dead symbols: ${dead} unreferenced nodes`);
              if (hubs > 3) risks.push(`  MEDIUM Hub nodes: ${hubs} nodes with >15 dependencies`);
              if (orphans > files * 0.3) risks.push(`  MEDIUM Orphan files: ${orphans} of ${files} files unreachable`);
              if (n > 0 && e / n < 0.5) risks.push(`  LOW    Sparse graph: avg degree ${(e/n).toFixed(2)}`);
              ok(`Risk Profile — ${new Date().toISOString().split('T')[0]}\n${'─'.repeat(50)}\n${risks.length ? risks.join('\n') : '  No significant risks detected.'}\n\nSummary: ${n} nodes · ${e} edges · ${files} files`);

            } else if (tool === 'monograph_author_analytics') {
              const limit = input.limit || 20;
              const { execSync: execS } = await import('child_process');
              try {
                const log = execS(`git log --format="%ae" --no-merges -- . 2>/dev/null | sort | uniq -c | sort -rn | head -${limit}`, { cwd: d2, encoding: 'utf-8', timeout: 5000 });
                if (!log.trim()) { ok('No git history found for this project directory.'); }
                else { ok(`Author Analytics (by commit count):\n${'─'.repeat(50)}\n${log.trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(.+)$/); return m ? `  ${m[2].padEnd(45)} ${m[1]} commits` : l; }).join('\n')}`); }
              } catch { ok('Author analytics requires git. Ensure this directory is a git repository.'); }

            } else if (tool === 'monograph_reachability') {
              // Files with no inbound edges (nothing imports them)
              const allNodes = db2.prepare(`SELECT id, name, file_path FROM nodes WHERE label IN ('File','Module') LIMIT 5000`).all();
              const inboundSet = new Set(db2.prepare(`SELECT DISTINCT target_id FROM edges`).all().map(r => r.target_id));
              const unreachable = allNodes.filter(n => !inboundSet.has(n.id)).slice(0, 40);
              const outdeg = db2.prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`);
              const degMap = {};
              for (const r of outdeg.all()) degMap[r.source_id] = r.c;
              if (!unreachable.length) { ok('All files have at least one inbound reference.'); }
              else ok(`Unreachable Files (${unreachable.length} of ${allNodes.length} total):\n${'─'.repeat(50)}\n${unreachable.slice(0,30).map(n => `  ${n.name || n.id.split('/').pop()} (imports ${degMap[n.id]||0} others)\n    ${n.file_path||''}`).join('\n\n')}`);

            } else if (tool === 'monograph_vital_signs_snapshot') {
              // Same as health_score — kept for backward compatibility
              const n = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
              const e = db2.prepare('SELECT COUNT(*) as c FROM edges').get().c;
              const dead = db2.prepare(`SELECT COUNT(*) as c FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM edges WHERE source_id=n.id OR target_id=n.id)`).get().c;
              const hubs = db2.prepare(`SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*)>20)`).get().c;
              const density = n > 1 ? (e / (n * (n-1))).toFixed(6) : '0';
              const score = Math.max(0, Math.min(100, Math.round(100 - (dead/Math.max(n,1)*30) - (hubs/Math.max(n,1)*500))));
              ok(`Vital Signs — ${new Date().toISOString()}\n${'─'.repeat(50)}\n  Health Score:  ${score}/100  ${score>=80?'✓ OK':score>=60?'⚠ Warning':'✗ Critical'}\n  Nodes:         ${n}\n  Edges:         ${e}\n  Density:       ${density}\n  Dead symbols:  ${dead} (${(dead/Math.max(n,1)*100).toFixed(1)}%)\n  Hub nodes:     ${hubs} nodes with >20 edges`);

            } else if (tool === 'monograph_circular_deps') {
              // Find import cycles using iterative DFS
              const limit = Math.min(parseInt(input.limit||'10'), 20);
              const importEdges = db2.prepare(`SELECT source_id, target_id FROM edges WHERE relation IN ('IMPORTS','REQUIRES','USES','DEPENDS_ON') LIMIT 50000`).all();
              const adj = {};
              for (const e of importEdges) { (adj[e.source_id] = adj[e.source_id]||[]).push(e.target_id); }
              const cycles = [];
              const visited = new Set(), inStack = new Set();
              function dfs(node, path) {
                if (cycles.length >= limit) return;
                if (inStack.has(node)) {
                  const cycleStart = path.indexOf(node);
                  if (cycleStart >= 0) cycles.push(path.slice(cycleStart).concat(node));
                  return;
                }
                if (visited.has(node)) return;
                visited.add(node); inStack.add(node); path.push(node);
                for (const nb of (adj[node]||[])) dfs(nb, path);
                path.pop(); inStack.delete(node);
              }
              for (const node of Object.keys(adj).slice(0, 2000)) dfs(node, []);
              const getName = id => id.split('/').slice(-2).join('/');
              if (!cycles.length) ok(`No circular dependencies found among ${Object.keys(adj).length} nodes with import edges.`);
              else ok(`Circular Dependencies (${cycles.length} found):\n${'─'.repeat(50)}\n${cycles.slice(0,limit).map((c,i) => `  ${i+1}. ${c.map(getName).join(' → ')}`).join('\n')}`);

            } else if (tool === 'monograph_largest_files') {
              const limit2 = Math.min(parseInt(input.limit||'25'), 50);
              const rows = db2.prepare(`SELECT file_path, MAX(end_line) as lines, COUNT(*) as symbols FROM nodes WHERE file_path IS NOT NULL AND end_line IS NOT NULL AND end_line > 0 GROUP BY file_path ORDER BY lines DESC LIMIT ${limit2}`).all();
              if (!rows.length) ok('No line-count data available. Ensure the index was built with source parsing enabled.');
              else ok(`Largest Files by Line Count:\n${'─'.repeat(50)}\n${rows.map((r,i) => `  ${String(i+1).padStart(2)}. ${r.lines.toString().padStart(5)} lines  ${r.symbols} symbols  ${r.file_path.split('/').slice(-2).join('/')}`).join('\n')}`);

            } else if (tool === 'monograph_coupling_balance') {
              // Fan-out (what this file uses) vs Fan-in (what uses this file)
              const limit3 = Math.min(parseInt(input.limit||'20'), 40);
              const fanOut = db2.prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`).all();
              const fanIn  = db2.prepare(`SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`).all();
              const outMap = {}, inMap = {};
              for (const r of fanOut) outMap[r.source_id] = r.c;
              for (const r of fanIn)  inMap[r.target_id]  = r.c;
              const allIds = new Set([...Object.keys(outMap), ...Object.keys(inMap)]);
              const nodes3 = db2.prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`).all();
              const fileSet = new Set(nodes3.map(n => n.id));
              const entries = [...allIds].filter(id => fileSet.has(id)).map(id => {
                const o = outMap[id]||0, i = inMap[id]||0;
                const n = nodes3.find(x=>x.id===id);
                return { name: n?.name || id.split('/').pop(), path: n?.file_path||'', out: o, inn: i, ratio: i > 0 ? (o/i).toFixed(1) : '∞' };
              }).filter(x => x.out > 0 || x.inn > 0).sort((a,b) => (b.out+b.inn) - (a.out+a.inn)).slice(0, limit3);
              ok(`Coupling Balance (Fan-out vs Fan-in, top ${limit3} by activity):\n${'─'.repeat(60)}\n  ${'File'.padEnd(35)} Out  In  Ratio\n${'─'.repeat(60)}\n${entries.map(e => `  ${e.name.slice(0,35).padEnd(35)} ${String(e.out).padStart(3)}  ${String(e.inn).padStart(2)}  ${e.ratio}`).join('\n')}`);

            } else if (tool === 'monograph_dead_exports') {
              // Exported symbols with zero inbound edges
              const exported = db2.prepare(`SELECT id, name, label, file_path FROM nodes WHERE is_exported=1 LIMIT 10000`).all();
              const inbound = new Set(db2.prepare(`SELECT DISTINCT target_id FROM edges`).all().map(r => r.target_id));
              const dead2 = exported.filter(n => !inbound.has(n.id));
              if (!dead2.length) ok('No dead exports found — all exported symbols have at least one inbound reference.');
              else ok(`Dead Exports — exported but never imported (${dead2.length} of ${exported.length} exported symbols):\n${'─'.repeat(50)}\n${dead2.slice(0,30).map(n => `  ${n.label.padEnd(12)} ${n.name}  →  ${(n.file_path||'').split('/').slice(-2).join('/')}`).join('\n')}`);

            } else if (tool === 'monograph_language_breakdown') {
              const rows2 = db2.prepare(`SELECT language, COUNT(*) as c FROM nodes WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC`).all();
              if (!rows2.length) ok('No language metadata available in this graph index.');
              else {
                const total2 = rows2.reduce((s,r) => s+r.c, 0);
                const maxC = rows2[0].c;
                ok(`Language Breakdown:\n${'─'.repeat(50)}\n${rows2.map(r => { const bar = '█'.repeat(Math.round(r.c/maxC*20)); const pct = (r.c/total2*100).toFixed(1); return `  ${r.language.padEnd(15)} ${bar.padEnd(20)} ${String(r.c).padStart(6)} (${pct}%)`; }).join('\n')}\n\n  Total nodes: ${total2}`);
              }

            } else if (tool === 'monograph_instability') {
              // Robert Martin's Instability = Ce / (Ca + Ce)
              // Ca = afferent coupling (in-degree), Ce = efferent coupling (out-degree)
              const limit4 = Math.min(parseInt(input.limit||'25'), 50);
              const outRows = db2.prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`).all();
              const inRows  = db2.prepare(`SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`).all();
              const Ce = {}, Ca = {};
              for (const r of outRows) Ce[r.source_id] = r.c;
              for (const r of inRows)  Ca[r.target_id]  = r.c;
              const fileNodes = db2.prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`).all();
              const entries4 = fileNodes.map(n => {
                const ca = Ca[n.id]||0, ce = Ce[n.id]||0;
                const total = ca + ce;
                const inst = total > 0 ? ce / total : 0;
                return { name: n.name||n.id.split('/').pop(), ca, ce, inst };
              }).filter(x => x.ca+x.ce > 0).sort((a,b) => b.inst - a.inst);
              const risky = entries4.filter(x => x.inst > 0.7 && x.ca > 3);
              const stable = entries4.filter(x => x.inst < 0.2 && x.ce > 3);
              ok(`Instability Index (Ce÷(Ca+Ce), 0=stable 1=unstable):\n${'─'.repeat(60)}\n\n  ⚠  High instability + high dependents (blast radius risk):\n${risky.slice(0,10).map(x => `     ${x.name.slice(0,40).padEnd(40)} I=${x.inst.toFixed(2)}  Ca=${x.ca}  Ce=${x.ce}`).join('\n')||'  none'}\n\n  ✓  Stable (low instability, many dependents on them):\n${stable.slice(0,8).map(x => `     ${x.name.slice(0,40).padEnd(40)} I=${x.inst.toFixed(2)}  Ca=${x.ca}  Ce=${x.ce}`).join('\n')||'  none'}\n\n  Total files analyzed: ${entries4.length}`);

            } else if (tool === 'monograph_churn_hotspots') {
              // Combines git churn frequency with structural complexity (out-degree)
              const limit5 = Math.min(parseInt(input.limit||'15'), 30);
              const { execSync: execS2 } = await import('child_process');
              let churnMap = {};
              try {
                const since = input.since || '6 months ago';
                const log2 = execS2(`git log --since="${since}" --name-only --format="" -- . 2>/dev/null | grep -v '^$' | sort | uniq -c | sort -rn | head -200`, { cwd: d2, encoding: 'utf-8', timeout: 8000 });
                for (const line of log2.trim().split('\n')) {
                  const m = line.trim().match(/^(\d+)\s+(.+)$/);
                  if (m) churnMap[m[2]] = parseInt(m[1]);
                }
              } catch {}
              if (!Object.keys(churnMap).length) { ok('No git history found — churn analysis requires a git repository.'); }
              else {
                const outDeg = db2.prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`).all();
                const degMap2 = {};
                for (const r of outDeg) degMap2[r.source_id] = r.c;
                const fileNodes2 = db2.prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`).all();
                const maxChurn = Math.max(...Object.values(churnMap), 1);
                const maxDeg2 = Math.max(...Object.values(degMap2), 1);
                const scored = fileNodes2.map(n => {
                  const fp = n.file_path || '';
                  const churn = churnMap[fp] || Object.entries(churnMap).find(([k]) => fp.endsWith(k))?.[1] || 0;
                  const deg = degMap2[n.id] || 0;
                  const score2 = (churn/maxChurn * 0.6) + (deg/maxDeg2 * 0.4);
                  return { name: n.name||fp.split('/').pop(), fp, churn, deg, score: score2 };
                }).filter(x => x.churn > 0 || x.deg > 5).sort((a,b) => b.score - a.score).slice(0, limit5);
                if (!scored.length) ok('No files matched both churn and complexity criteria.');
                else ok(`Churn × Complexity Hotspots (60% churn weight + 40% coupling weight):\n${'─'.repeat(60)}\n  ${'File'.padEnd(38)} Churn  Deps  Score\n${'─'.repeat(60)}\n${scored.map(x => `  ${x.name.slice(0,38).padEnd(38)} ${String(x.churn).padStart(5)}  ${String(x.deg).padStart(4)}  ${(x.score*100).toFixed(0)}%`).join('\n')}\n\n  Analyzed: ${scored.length} hotspot candidates from last ${input.since||'6 months'}`);
              }

            } else {
              ok(`Tool "${tool}" not implemented in control panel`);
            }
          } finally { closeDb(db2); }
        } catch(e2) { err(String(e2)); }
      });
      return;
    }

    // -------------------------------------------------- GET /api/monograph-benchmark
    if (req.method === 'GET' && url === '/api/monograph-benchmark') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());
        const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
        const legacyPath = path.join(d, 'graphify-out', 'graph.json');
        const gp = fs.existsSync(graphPath) ? graphPath : (fs.existsSync(legacyPath) ? legacyPath : null);

        if (!gp) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ available: false }));
          return;
        }

        const { execSync: ex } = await import('child_process');
        const out = ex(`graphify benchmark ${gp}`, { encoding: 'utf8', cwd: d, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ available: true, result: out }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }


    // ------------------------------------------------------- GET /api/graph
    if (req.method === 'GET' && url === '/api/graph') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const d = path.resolve(dir || process.cwd());

        // Find session files — sort by mtime descending before processing
        const homeDir = os.homedir();
        const slug = d.replace(/\//g, '-');
        const sessionsDir = fs.existsSync(path.join(homeDir, '.claude', 'projects', slug))
          ? path.join(homeDir, '.claude', 'projects', slug)
          : path.join(d, '.claude', 'sessions');

        let sessionFiles = [];
        try {
          sessionFiles = fs.readdirSync(sessionsDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(sessionsDir, f)).mtimeMs; } catch { return 0; } })() }))
            .sort((a, b) => b.mtime - a.mtime)
            .map(({ f }) => f);
        } catch {}

        // Parse each session: count tool categories + agent type spawns
        const TOOL_CAT = name => {
          if (['Read','Write','Edit','MultiEdit','Glob','Grep','LS'].includes(name)) return 'file';
          if (name === 'Bash') return 'bash';
          if (['Agent','Task'].includes(name)) return 'agent';
          if (name.startsWith('mcp__monomind__memory') || name.startsWith('mcp__monomind__agentdb')) return 'memory';
          if (['WebFetch','WebSearch'].includes(name)) return 'web';
          if (name === 'Skill') return 'skill';
          return 'other';
        };

        const nodes = [];
        const edges = [];
        const agentTypeNodes = {}; // subagent_type → node id

        for (const fname of sessionFiles) {
          const sid = fname.replace('.jsonl','');
          const fp = path.join(sessionsDir, fname);
          let stat = null;
          try { stat = fs.statSync(fp); } catch { continue; }

          // Skip files over size cap to avoid memory spikes on large sessions
          // But still do a lightweight scan for agent spawns (tool_use blocks named Agent/Task)
          if (stat.size > JSONL_SIZE_CAP) {
            const truncSpawns = {};
            try {
              const raw = fs.readFileSync(fp, 'utf8');
              for (const line of raw.split('\n')) {
                if (!line.includes('"tool_use"') || (!line.includes('"Agent"') && !line.includes('"Task"'))) continue;
                let e; try { e = JSON.parse(line); } catch { continue; }
                if (e.type !== 'assistant') continue;
                for (const block of (e.message?.content || [])) {
                  if (!block || block.type !== 'tool_use') continue;
                  if (block.name !== 'Agent' && block.name !== 'Task') continue;
                  const sub = block.input?.subagent_type || block.input?.description || '?';
                  truncSpawns[sub] = (truncSpawns[sub] || 0) + 1;
                }
              }
            } catch {}
            nodes.push({ id: sid, type: 'session', label: sid.slice(0,8), turns: 0, totalTools: 0,
              toolCounts: {}, cost: 0, mtime: stat.mtimeMs, size: stat.size, agentSpawns: truncSpawns, truncated: true });
            for (const [subType, count] of Object.entries(truncSpawns)) {
              const nodeId = 'agent::' + subType;
              if (!agentTypeNodes[subType]) {
                agentTypeNodes[subType] = true;
                nodes.push({ id: nodeId, type: 'agenttype', label: subType, totalSpawns: 0 });
              }
              const aNode = nodes.find(n => n.id === nodeId);
              if (aNode) aNode.totalSpawns = (aNode.totalSpawns || 0) + count;
              edges.push({ source: sid, target: nodeId, weight: count, label: String(count) });
            }
            continue;
          }

          const toolCounts = {};
          const agentSpawns = {}; // subagent_type → count
          let turns = 0, totalCost = 0;

          try {
            const raw = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
            const lines = raw.split('\n').filter(Boolean);
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.type === 'user') {
                // Only count actual human turns, not tool-result responses
                const ct = e.message?.content;
                const isToolResult = Array.isArray(ct) && ct.length > 0 && ct.every(b => b && b.type === 'tool_result');
                if (!isToolResult) turns++;
              }
              if (e.type === 'assistant') {
                for (const block of (e.message?.content || [])) {
                  if (!block || block.type !== 'tool_use') continue;
                  const cat = TOOL_CAT(block.name);
                  toolCounts[cat] = (toolCounts[cat] || 0) + 1;
                  if (cat === 'agent') {
                    const sub = block.input?.subagent_type || block.input?.description || '?';
                    agentSpawns[sub] = (agentSpawns[sub] || 0) + 1;
                  }
                }
                if (e.message?.usage) totalCost += _sjCalcCost(e.message.model || '', e.message.usage);
              }
            }
          } catch {}

          const totalTools = Object.values(toolCounts).reduce((a,b)=>a+b,0);
          nodes.push({
            id: sid, type: 'session', label: sid.slice(0,8),
            turns, totalTools, toolCounts,
            cost: totalCost, mtime: stat.mtimeMs, size: stat.size,
            agentSpawns
          });

          // Create/link agent type nodes
          for (const [subType, count] of Object.entries(agentSpawns)) {
            const nodeId = 'agent::' + subType;
            if (!agentTypeNodes[subType]) {
              agentTypeNodes[subType] = true;
              nodes.push({ id: nodeId, type: 'agenttype', label: subType, totalSpawns: 0 });
            }
            const aNode = nodes.find(n => n.id === nodeId);
            if (aNode) aNode.totalSpawns = (aNode.totalSpawns || 0) + count;
            edges.push({ source: sid, target: nodeId, weight: count, label: String(count) });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ nodes, edges }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- GET /api/swarm-history
    if (req.method === 'GET' && url === '/api/swarm-history') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        const entries = collectSwarmHistory(path.resolve(dir));
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ entries }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- GET /api/swarm-events
    if (req.method === 'GET' && url === '/api/swarm-events') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const dir = qs.get('dir') || projectDir || process.cwd();
        // Cap swarmId and agentId to prevent O(n×m) DoS: filter() compares
        // each event against the query string, so a megabyte-scale ID causes
        // O(events × m) string comparisons.
        const _rawSwarmId = qs.get('swarmId') || undefined;
        const _rawAgentId = qs.get('agentId') || undefined;
        const swarmId = typeof _rawSwarmId === 'string' ? _rawSwarmId.slice(0, 256) : undefined;
        const agentId = typeof _rawAgentId === 'string' ? _rawAgentId.slice(0, 256) : undefined;
        const last = qs.get('last') ? parseInt(qs.get('last')) : undefined;
        const events = collectSwarmEvents(path.resolve(dir), { swarmId, agentId, last });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ events, count: events.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- GET /api/swarm-data-size
    if (req.method === 'GET' && url === '/api/swarm-data-size') {
      try {
        const dir = new URL(req.url, 'http://localhost').searchParams.get('dir') || projectDir || process.cwd();
        const size = getSwarmDataSize(path.resolve(dir));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(size));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------- DELETE /api/swarm-clean
    if (req.method === 'DELETE' && url === '/api/swarm-clean') {
      try {
        const dir = new URL(req.url, 'http://localhost').searchParams.get('dir') || projectDir || process.cwd();
        const result = cleanSwarmData(path.resolve(dir));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // -------------------------------------------------- GET /api/token-usage
    if (req.method === 'GET' && url.startsWith('/api/token-usage')) {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const period = ['today','week','30days','month'].includes(qs.get('period')) ? qs.get('period') : 'today';
        const dir = path.resolve(qs.get('dir') || projectDir || process.cwd());
        const trackerPath = path.join(dir, '.claude', 'helpers', 'token-tracker.cjs');
        const fallback = () => {
          const summary = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.monomind', 'metrics', 'token-summary.json'), 'utf8')); } catch { return {}; } })();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          const fbSum = { todayCost: summary.todayCost || 0, cost: summary.todayCost || 0, todayCalls: summary.todayCalls || 0, calls: summary.todayCalls || 0, totalTokens: 0, totalTokensIn: 0, totalTokensOut: 0, cacheTokens: 0, modelCount: 0 };
          res.end(JSON.stringify({ summary: fbSum, totalCost: summary.todayCost || 0, totalCalls: summary.todayCalls || 0, totalIn: 0, totalOut: 0, totalCR: 0, totalCW: 0, rows: [], models: [], categories: [], tools: [], mcpServers: [], projects: [], modelBreakdown: {}, categoryBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, periodLabel: period }));
        };
        if (!fs.existsSync(trackerPath)) { fallback(); return; }
        try {
          const _req = createRequire(import.meta.url);
          const tracker = _req(trackerPath);
          const range = tracker.getDateRange(period);
          const projects = tracker.parseAllSessions(range.start, range.end);
          let totalCost = 0, totalIn = 0, totalOut = 0, totalCR = 0, totalCW = 0, totalCalls = 0;
          const modelBreakdown = {}, categoryBreakdown = {}, toolBreakdown = {}, mcpBreakdown = {};
          for (const p of projects) {
            totalCost += p.totalCost || 0;
            for (const s of (p.sessions || [])) {
              totalIn += s.totalInputTokens || 0;
              totalOut += s.totalOutputTokens || 0;
              totalCR += s.totalCacheRead || 0;
              totalCW += s.totalCacheWrite || 0;
              totalCalls += s.apiCalls || 0;
              for (const [mn, m] of Object.entries(s.modelBreakdown || {})) {
                if (!modelBreakdown[mn]) modelBreakdown[mn] = { calls: 0, cost: 0, tokens: 0 };
                modelBreakdown[mn].calls += m.calls || 0;
                modelBreakdown[mn].cost += m.cost || 0;
                modelBreakdown[mn].tokens += m.tokens || 0;
              }
              for (const [cat, c] of Object.entries(s.categoryBreakdown || {})) {
                if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { turns: 0, cost: 0 };
                categoryBreakdown[cat].turns += c.turns || 0;
                categoryBreakdown[cat].cost += c.cost || 0;
              }
              for (const [tool, t] of Object.entries(s.toolBreakdown || {})) {
                if (!toolBreakdown[tool]) toolBreakdown[tool] = { calls: 0 };
                toolBreakdown[tool].calls += t.calls || 0;
              }
              for (const [srv, m] of Object.entries(s.mcpBreakdown || {})) {
                if (!mcpBreakdown[srv]) mcpBreakdown[srv] = { calls: 0 };
                mcpBreakdown[srv].calls += m.calls || 0;
              }
            }
          }
          // Build client-friendly arrays from breakdown dicts
          const models = Object.entries(modelBreakdown).map(([model, m]) => ({ model, cost: m.cost, calls: m.calls, tokens: m.tokens })).sort((a, b) => b.cost - a.cost);
          const categories = Object.entries(categoryBreakdown).map(([category, c]) => ({ category, turns: c.turns, cost: c.cost })).sort((a, b) => b.turns - a.turns);
          const tools = Object.entries(toolBreakdown).map(([tool, t]) => ({ tool, count: t.calls })).sort((a, b) => b.count - a.count);
          const mcpServers = Object.entries(mcpBreakdown).map(([server, m]) => ({ server, count: m.calls })).sort((a, b) => b.count - a.count);
          const projectRows = projects.map(p => ({ project: p.name || p.slug || p.dir || '?', cost: p.totalCost || 0 })).sort((a, b) => b.cost - a.cost);
          // Build rows array from sessions for per-session table
          const rows = [];
          for (const p of projects) {
            for (const s of (p.sessions || [])) {
              rows.push({ id: s.id || '', session: s.lastPrompt || s.id || '', calls: s.apiCalls || 0, cost: s.totalCost || 0, tokens: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0) });
            }
          }
          rows.sort((a, b) => b.cost - a.cost);
          // Summary object matching client expectations
          const summary = { todayCost: totalCost, cost: totalCost, todayCalls: totalCalls, calls: totalCalls, totalTokens: totalIn + totalOut, totalTokensIn: totalIn, totalTokensOut: totalOut, cacheTokens: totalCR, modelCount: models.length };
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          res.end(JSON.stringify({ summary, totalCost, totalCalls, totalIn, totalOut, totalCR, totalCW, rows, models, categories, tools, mcpServers, projects: projectRows, modelBreakdown, categoryBreakdown, toolBreakdown, mcpBreakdown, periodLabel: period }));
        } catch (e) { fallback(); }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/section
    if (req.method === 'GET' && url === '/api/section') {
      try {
        const qs = new URL(req.url, 'http://localhost').searchParams;
        const name = qs.get('name') || '';
        const dir = qs.get('dir') || projectDir || process.cwd();
        const full = qs.get('full') === '1';
        let partial = buildSectionData(name, dir || process.cwd());
        // For full knowledge request, include all chunks
        if (name === 'knowledge' && full) {
          const chunksPath = path.join(path.resolve(dir || process.cwd()), '.monomind', 'knowledge', 'chunks.jsonl');
          let allChunks = [];
          try {
            const raw = fs.readFileSync(chunksPath, 'utf8');
            allChunks = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          } catch {}
          partial = { knowledge: { ...partial.knowledge, allChunks } };
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify(partial));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- GET /api/stream
    if (req.method === 'GET' && url === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });

      // Keep the connection alive with periodic comments
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 20_000);

      addSseClient(res);

      req.on('close', () => {
        clearInterval(keepAlive);
        removeSseClient(res);
      });

      // Send the initial snapshot immediately
      try {
        const snapshot = await collectAll(projectDir);
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      return;
    }

    // ---------------------------------------------------- GET /favicon.ico
    if (req.method === 'GET' && url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ------------------------------------------------- Monograph
    // GET /api/monograph — node/edge counts, top god nodes, type distribution.
    // (Distinct from /api/graph which serves session/journal graph data.)
    // Reads .monomind/monograph.db via sqlite3 CLI to avoid bundling better-sqlite3.
    if (req.method === 'GET' && url === '/api/monograph') {
      try {
        const dbPath = path.join(projectDir || process.cwd(), '.monomind', 'monograph.db');
        if (!fs.existsSync(dbPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ exists: false }));
          return;
        }
        const { execSync } = await import('child_process');
        // Pipe SQL via stdin to avoid shell quoting issues with single-quoted SQL strings.
        const runSql = (sql, timeout = 5000) => {
          try {
            return execSync(`sqlite3 -json "${dbPath}"`,
              { encoding: 'utf-8', timeout: timeout, input: sql + ';' });
          } catch (e) { return '[]'; }
        };
        const counts = JSON.parse(runSql(
          "SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges;"
        ) || '[{}]')[0] || { nodes: 0, edges: 0 };
        // Compute degree in one pass via GROUP BY (much faster than per-row subquery).
        const gods = JSON.parse(runSql(
          "WITH deg(node_id, d) AS (" +
          "  SELECT source_id, COUNT(*) FROM edges GROUP BY source_id " +
          "  UNION ALL " +
          "  SELECT target_id, COUNT(*) FROM edges GROUP BY target_id" +
          "), totals AS (" +
          "  SELECT node_id, SUM(d) AS deg FROM deg GROUP BY node_id" +
          ") " +
          "SELECT n.name, n.label, n.file_path, t.deg " +
          "FROM nodes n JOIN totals t ON t.node_id = n.id " +
          "WHERE n.label NOT IN ('Concept') " +
          "AND n.file_path IS NOT NULL AND n.file_path != '' " +
          "AND n.name NOT LIKE '(%' AND length(n.name) >= 3 " +
          "ORDER BY t.deg DESC LIMIT 20",
          10000
        ) || '[]');
        const types = JSON.parse(runSql(
          "SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC LIMIT 12"
        ) || '[]');
        const relations = JSON.parse(runSql(
          "SELECT relation, COUNT(*) AS count FROM edges GROUP BY relation ORDER BY count DESC"
        ) || '[]');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          exists: true,
          nodes: counts.nodes,
          edges: counts.edges,
          godNodes: gods,
          typeDistribution: types,
          relationDistribution: relations,
          updatedAt: fs.statSync(dbPath).mtime,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // ------------------------------------------------- Org management
    // GET /api/orgs — list all saved org configs
    if (req.method === 'GET' && url === '/api/orgs') {
      try {
        const _orgsQs = new URL(req.url, 'http://localhost').searchParams;
        const _orgsExplicitDir = _orgsQs.get('dir');
        const _orgsServerRoot = path.resolve(_orgsExplicitDir || projectDir || process.cwd());
        // Collect project dirs to search: explicit dir + known-projects (like sessions API)
        const _orgsProjDirs = new Set([_orgsServerRoot]);
        if (!_orgsExplicitDir) {
          try {
            const _knownOrgsFile = path.join(_orgsServerRoot, 'data', 'known-projects.json');
            if (fs.existsSync(_knownOrgsFile)) {
              JSON.parse(fs.readFileSync(_knownOrgsFile, 'utf8')).forEach(p => _orgsProjDirs.add(p));
            }
          } catch(_) {}
        }
        const _sidecarSuffixRe = /-(approvals|state|activity|goals|routines|projects|members|issues|workspaces|worktrees|environments|plugins|adapters|bootstrap|threads|budgets|project-workspaces|approval-comments|secrets|join-requests|skills)\.json$/;
        const _orgsSeen = new Set();
        let orgs = [];
        for (const _opd of _orgsProjDirs) {
          const orgsDir = path.join(_opd, '.monomind', 'orgs');
          if (!fs.existsSync(orgsDir)) continue;
          const files = fs.readdirSync(orgsDir).filter(f => f.endsWith('.json') && !_sidecarSuffixRe.test(f));
          for (const f of files) {
            try {
              const cfg = JSON.parse(fs.readFileSync(path.join(orgsDir, f), 'utf8'));
              const _lOrgName = cfg.name || '';
              if (!_lOrgName || _orgsSeen.has(_lOrgName)) continue;
              _orgsSeen.add(_lOrgName);
              const _rs = _readRunState(_lOrgName, _opd);
              const _ttl = Math.max((_rs?.checkpointInterval || 600000) * 2, 7200000);
              let running = (_rs?.status === 'running' && (Date.now() - (_rs?.lastEventAt || 0)) < _ttl)
                || activeOrgRuns.has(_lOrgName);
              orgs.push({ name: cfg.name, goal: cfg.goal, roles: Array.isArray(cfg.roles) ? cfg.roles : [], topology: cfg.topology, created_at: cfg.created_at, running, status: cfg.status, projectDir: _opd, lastEventAt: _rs?.lastEventAt || null, loop: cfg.loop ? { poll_interval_minutes: cfg.loop.poll_interval_minutes, last_run: cfg.loop.last_run, next_run: cfg.loop.next_run } : undefined });
            } catch(_) {}
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(orgs));
      } catch(_) { res.writeHead(500); res.end('[]'); }
      return;
    }

    // POST /api/orgs/:name/import — import an org config by name (orgs.html upload flow)
    if (req.method === 'POST' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/import$/i.test(url)) {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        try {
          const urlParts = url.split('/');
          const orgName = decodeURIComponent(urlParts[3]);
          if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid org name' })); return; }
          const cfg = JSON.parse(body);
          const _importQs = new URL(req.url, 'http://localhost').searchParams;
          const dir = path.resolve(_importQs.get('dir') || projectDir || process.cwd());
          const orgsDir = path.join(dir, '.monomind', 'orgs');
          fs.mkdirSync(orgsDir, { recursive: true });
          const destFile = path.join(orgsDir, `${orgName}.json`);
          fs.writeFileSync(destFile, JSON.stringify({ ...cfg, name: orgName }, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, name: orgName, file: destFile }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /api/orgs — import / create org from JSON body
    if (req.method === 'POST' && url === '/api/orgs') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        try {
          const cfg = JSON.parse(body);
          const qs = new URL(req.url, 'http://localhost').searchParams;
          const dir = qs.get('dir') || cfg.dir || projectDir || process.cwd();
          const name = (cfg.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
          if (!name) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid org name' })); return; }
          const orgsDir = path.join(path.resolve(dir), '.monomind', 'orgs');
          fs.mkdirSync(orgsDir, { recursive: true });
          const destFile = path.join(orgsDir, `${name}.json`);
          const cleanCfg = Object.fromEntries(Object.entries({ ...cfg, name }).filter(([k]) => !k.startsWith('_')));
          fs.writeFileSync(destFile, JSON.stringify(cleanCfg, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, name, file: destFile }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /api/orgs/:name — get specific org config (exact path: /api/orgs/<slug>)
    if (req.method === 'GET' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)) {
      try {
        const orgName = decodeURIComponent(url.slice('/api/orgs/'.length));
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _orgsOneQs = new URL(req.url, 'http://localhost').searchParams;
        const _orgsOneRoot = path.resolve(_orgsOneQs.get('dir') || projectDir || process.cwd());
        const _orgsOneProjDir = _resolveOrgProjectDir(orgName, _orgsOneRoot) || _orgsOneRoot;
        const f = path.join(_orgsOneProjDir, '.monomind', 'orgs', `${orgName}.json`);
        if (!fs.existsSync(f)) { res.writeHead(404); res.end('{"error":"not found"}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(fs.readFileSync(f, 'utf8'));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name — ORG ROOM: rich org data (config + state + tasks + routines + goals)
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)) {
      try {
        const orgName = decodeURIComponent(url.slice('/api/org/'.length));
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _orgQs = new URL(req.url, 'http://localhost').searchParams;
        const _orgServerRoot = path.resolve(_orgQs.get('dir') || projectDir || process.cwd());
        // Resolve which project dir actually has this org's config
        const d = _resolveOrgProjectDir(orgName, _orgServerRoot) || _orgServerRoot;
        const orgsDir = path.join(d, '.monomind', 'orgs');

        const readJsonSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) { return null; } };

        const configFile = path.join(orgsDir, `${orgName}.json`);
        if (!fs.existsSync(configFile)) { res.writeHead(404); res.end('{"error":"org not found"}'); return; }
        const config = readJsonSafe(configFile);

        const state = readJsonSafe(path.join(orgsDir, `${orgName}-state.json`)) || { agents: {} };
        const goalsData = readJsonSafe(path.join(orgsDir, `${orgName}-goals.json`)) || { goals: [] };
        const routinesData = readJsonSafe(path.join(orgsDir, `${orgName}-routines.json`)) || { routines: [] };
        const approvalsData = readJsonSafe(path.join(orgsDir, `${orgName}-approvals.json`)) || { approvals: [] };

        // Check running status: stop file absence AND (in-memory activeOrgRuns OR state-file agents OR active loop file)
        const stopFile = path.join(orgsDir, '.stops', `${orgName}.stop`);
        const _loopsDir = path.join(d, '.monomind', 'loops');
        const _loopRunning = (() => {
          try {
            if (!fs.existsSync(_loopsDir)) return false;
            // Get the org's state file mtime to correlate with loop activity
            const orgStateMtime = (() => {
              try { return fs.statSync(path.join(orgsDir, `${orgName}-state.json`)).mtimeMs; } catch { return 0; }
            })();
            // Also check org's most recent run file mtime
            const orgRunsDir = path.join(_getGitMonomindDir(d) || path.join(d, '.monomind'), 'orgs', orgName, 'runs');
            const orgLastRunMtime = (() => {
              try {
                if (!fs.existsSync(orgRunsDir)) return 0;
                const runFiles = fs.readdirSync(orgRunsDir).filter(f => f.endsWith('.jsonl'));
                if (!runFiles.length) return 0;
                return Math.max(...runFiles.map(f => { try { return fs.statSync(path.join(orgRunsDir, f)).mtimeMs; } catch { return 0; } }));
              } catch { return 0; }
            })();
            const orgLastActivity = Math.max(orgStateMtime, orgLastRunMtime);
            return fs.readdirSync(_loopsDir).some(f => {
              if (!f.endsWith('.json') || f.endsWith('.stop')) return false;
              try {
                const lp = JSON.parse(fs.readFileSync(path.join(_loopsDir, f), 'utf8'));
                if (!lp.command || !lp.command.includes('runorg')) return false;
                if (!['running', 'paused'].includes(lp.status)) return false;
                // Primary match: explicit orgName field (written by runorg command since v1.14.2)
                if (lp.orgName === orgName) return true;
                // Fallback: org name in prompt (early loop files that preserved --org flag)
                if ((lp.prompt || '').includes(orgName)) return true;
                // Heuristic: if loop's lastRunAt is within 3x wait interval of org's last activity
                const waitMs = (lp.wait || 60) * 3 * 1000;
                return orgLastActivity > 0 && Math.abs(orgLastActivity - (lp.lastRunAt || 0)) < waitMs;
              } catch { return false; }
            });
          } catch { return false; }
        })();
        const _runstateData = _readRunState(orgName, d);
        const _runstateTtl = Math.max((_runstateData?.checkpointInterval || 600000) * 2, 7200000);
        const _runstateAlive = _runstateData?.status === 'running' && (Date.now() - (_runstateData?.lastEventAt || 0)) < _runstateTtl;
        const running = !fs.existsSync(stopFile) && (_runstateAlive || activeOrgRuns.has(orgName) || _loopRunning);

        // Read real tasks from the task store and group by status column
        const taskStoreData = readJsonSafe(path.join(d, '.monomind', 'tasks', 'store.json'));
        const allTasks = taskStoreData ? Object.values(taskStoreData.tasks || {}) : [];
        const tasks = {
          todo: allTasks.filter(t => t.status === 'pending').map(t => ({ id: t.taskId, description: t.description, status: 'todo', ts: t.createdAt })),
          doing: allTasks.filter(t => t.status === 'in_progress').map(t => ({ id: t.taskId, description: t.description, status: 'doing', ts: t.startedAt || t.createdAt })),
          done: allTasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled').map(t => ({ id: t.taskId, description: t.description, status: t.status, ts: t.completedAt || t.createdAt })),
        };

        const result = { config, state, goals: goalsData.goals, routines: routinesData.routines,
          approvals: approvalsData.approvals, running, tasks,
          runId: _runstateData?.runId || null,
          lastEventAt: _runstateData?.lastEventAt || null,
          agentStates: _runstateData?.agentStates || {} };

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/activity — recent org events from mastermind-events.jsonl
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/activity$/i.test(url)) {
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('[]'); return; }
        const _actQs = new URL(req.url, 'http://localhost').searchParams;
        const _actServerRoot = path.resolve(_actQs.get('dir') || projectDir || process.cwd());
        const d = _resolveOrgProjectDir(orgName, _actServerRoot) || _actServerRoot;
        const orgsDir = path.join(d, '.monomind', 'orgs');
        const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) { return null; } };
        const events = [];

        // 1) Global mastermind events that EXPLICITLY belong to this org (strict — no untagged leak)
        const eventsFile = path.join(d, 'data', 'mastermind-events.jsonl');
        if (fs.existsSync(eventsFile)) {
          const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
          for (const l of lines.slice(-1000)) {
            try { const e = JSON.parse(l); if (e && e.org === orgName) events.push(e); } catch(_) {}
          }
        }

        // 2) Synthesize an org-scoped timeline from this org's own records (real data, distinct per org)
        const cfg = readJ(path.join(orgsDir, `${orgName}.json`));
        if (cfg) {
          const createdMs = cfg.created_at ? Date.parse(cfg.created_at) : null;
          if (createdMs) events.push({ type: 'org:create', ts: createdMs, msg: String(cfg.goal || 'Org created').slice(0, 80) });
          (cfg.roles || []).forEach((r, i) => {
            events.push({ type: 'role:defined', ts: createdMs ? createdMs + (i + 1) * 1000 : null, role: r.title || r.id, msg: r.agent_type || '' });
          });
        }
        const goals = readJ(path.join(orgsDir, `${orgName}-goals.json`));
        (goals?.goals || []).forEach(g => events.push({ type: 'goal', ts: Date.parse(g.created_at || g.updated_at || '') || null, role: g.status || '', msg: String(g.text || g.title || g.goal || '').slice(0, 80) }));
        const appr = readJ(path.join(orgsDir, `${orgName}-approvals.json`));
        (appr?.approvals || []).forEach(a => { const ts = (typeof a.ts === 'number') ? a.ts : (Date.parse(a.created_at || a.ts || '') || null); events.push({ type: 'approval', ts, role: a.agent_id || a.requester || '', msg: String(a.title || a.action || '').slice(0, 80) }); });
        const state = readJ(path.join(orgsDir, `${orgName}-state.json`));
        if (state && state.agents) {
          for (const [aid, a] of Object.entries(state.agents)) {
            const raw = a.lastHeartbeat || a.last_seen || a.updated_at || null;
            const ts = (typeof raw === 'number') ? raw : (raw ? Date.parse(raw) : null);
            events.push({ type: 'org:heartbeat', ts, agent: aid, msg: a.status || '' });
          }
        }

        const out = events.filter(e => e && e.ts).sort((a, b) => b.ts - a.ts).slice(0, 100);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(out));
      } catch(_) { res.writeHead(500); res.end('[]'); }
      return;
    }

    // GET /api/org/:name/projects — org projects from projects json file
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/projects$/i.test(url)) {
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('[]'); return; }
        const _projsQs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(_projsQs.get('dir') || projectDir || process.cwd());
        const projFile = path.join(d, '.monomind', 'orgs', `${orgName}-projects.json`);
        if (!fs.existsSync(projFile)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('[]'); return; }
        const data = JSON.parse(fs.readFileSync(projFile, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data.projects || []));
      } catch(_) { res.writeHead(500); res.end('[]'); }
      return;
    }

    // GET /api/org/:name/members — org member list and join requests
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/members$/i.test(url)) {
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('{}'); return; }
        const _membersQs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(_membersQs.get('dir') || projectDir || process.cwd());
        const membersFile = path.join(d, '.monomind', 'orgs', `${orgName}-members.json`);
        if (!fs.existsSync(membersFile)) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end('{"members":[],"join_requests":[]}');
          return;
        }
        const data = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/adapters — org adapter registry
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/adapters$/i.test(url)) {
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('{}'); return; }
        const _adaptersQs = new URL(req.url, 'http://localhost').searchParams;
        const _adaptersRoot = path.resolve(_adaptersQs.get('dir') || projectDir || process.cwd());
        const d = _resolveOrgProjectDir(orgName, _adaptersRoot) || _adaptersRoot;
        const adaptersFile = path.join(d, '.monomind', 'orgs', `${orgName}-adapters.json`);
        if (!fs.existsSync(adaptersFile)) {
          // Return defaults derived from org config if available
          const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
          let defaultAdapter = 'claude-sonnet-4-6';
          try { defaultAdapter = JSON.parse(fs.readFileSync(orgFile, 'utf8'))?.run_config?.ceo_adapter || defaultAdapter; } catch(_) {}
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ default_adapter: defaultAdapter, adapters: [
            { type: 'claude-local', label: 'Claude (local CLI)', source: 'built-in', disabled: false, modelsCount: 3 },
            { type: 'gemini-local', label: 'Gemini (local)', source: 'built-in', disabled: false, modelsCount: 1 },
            { type: 'http', label: 'HTTP Adapter', source: 'built-in', disabled: true, modelsCount: 0 },
          ]}));
          return;
        }
        const data = JSON.parse(fs.readFileSync(adaptersFile, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/skills — list skills from .claude/skills/ mapped to org roles
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/skills$/i.test(url)) {
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('{}'); return; }
        const _skillsQs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(_skillsQs.get('dir') || projectDir || process.cwd());
        const skillsDir = path.join(d, '.claude', 'skills');
        const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);

        // Scan skills directory
        const skills = [];
        if (fs.existsSync(skillsDir)) {
          const scanDir = (dir, prefix) => {
            try {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) { scanDir(path.join(dir, entry.name), `${entry.name}:`); }
                else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
                  const slug = entry.name.replace(/\.md$/, '');
                  const content = fs.readFileSync(path.join(dir, entry.name), 'utf8').slice(0, 500);
                  const typeMatch = content.match(/^type:\s*(.+)$/m);
                  const modeMatch = content.match(/^default_mode:\s*(.+)$/m);
                  const descMatch = content.match(/^description:\s*(.+)$/m);
                  skills.push({
                    name: `${prefix}${slug}`,
                    slug,
                    type: typeMatch ? typeMatch[1].trim() : 'skill',
                    default_mode: modeMatch ? modeMatch[1].trim() : 'auto',
                    description: descMatch ? descMatch[1].trim() : '',
                  });
                }
              }
            } catch(_) {}
          };
          scanDir(skillsDir, '');
        }

        // Map skills enabled per role from org config
        let roleSkillMap = {};
        if (fs.existsSync(orgFile)) {
          try {
            const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
            for (const role of (config.roles || [])) {
              roleSkillMap[role.id] = role.skills || [];
            }
          } catch(_) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ skills, role_skill_map: roleSkillMap }));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/agent/:roleId — full agent detail: org role + .claude/agents definition
    //   (characteristics, skills/expertise, responsibilities, instructions document)
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agent\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)) {
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        const roleId = decodeURIComponent(parts[5]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('{}'); return; }
        if (roleId.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(roleId)) { res.writeHead(400); res.end('{}'); return; }
        const _agentQs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(_agentQs.get('dir') || projectDir || process.cwd());
        const orgFile = path.join(d, '.monomind', 'orgs', `${orgName}.json`);
        if (!fs.existsSync(orgFile)) { res.writeHead(404); res.end('{}'); return; }
        const config = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
        const role = (config.roles || []).find(r => r.id === roleId);
        if (!role) { res.writeHead(404); res.end('{}'); return; }

        const agentType = String(role.agent_type || role.type || '').toLowerCase();
        const wanted = [agentType, String(role.id).toLowerCase()].filter(Boolean);

        // Find a matching agent definition under .claude/agents (recursive); match frontmatter name then filename.
        const agentsDir = path.join(d, '.claude', 'agents');
        let definition = { found: false };
        if (wanted.length && fs.existsSync(agentsDir)) {
          const stack = [agentsDir];
          let nameMatch = null, slugMatch = null;
          while (stack.length && !nameMatch) {
            const dir = stack.pop();
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) { stack.push(full); continue; }
              if (!e.name.endsWith('.md') || e.name.startsWith('_')) continue;
              const slug = e.name.replace(/\.md$/, '').toLowerCase();
              let raw = '';
              try { raw = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
              const fmName = ((raw.match(/^name:\s*(.+)$/m) || [])[1] || '').trim().toLowerCase();
              if (fmName && wanted.includes(fmName)) { nameMatch = { full, raw }; break; }
              if (!slugMatch && wanted.includes(slug)) slugMatch = { full, raw };
            }
          }
          const match = nameMatch || slugMatch;
          if (match) {
            definition = parseAgentDef(match.raw);
            definition.found = true;
            definition.file = path.relative(d, match.full);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ role, definition }));
      } catch (_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/search?q=<query> — fuzzy search across org data
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/search(\?.*)?$/i.test(url)) {
      try {
        const urlObj = new URL(`http://x${req.url}`);
        const orgName = decodeURIComponent(urlObj.pathname.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('{}'); return; }
        const q = (urlObj.searchParams.get('q') || '').toLowerCase().trim();
        if (!q || q.length < 2) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{"hits":[]}'); return; }

        const d = path.resolve(urlObj.searchParams.get('dir') || projectDir || process.cwd());
        const orgsDir = path.join(d, '.monomind', 'orgs');
        const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) { return null; } };

        const hits = [];
        const match = (str) => str && str.toLowerCase().includes(q);

        // Agents
        const config = readJ(path.join(orgsDir, `${orgName}.json`));
        for (const role of (config?.roles || [])) {
          if (match(role.id) || match(role.title) || (role.responsibilities || []).some(r => match(r))) {
            hits.push({ type: 'agent', id: role.id, title: role.title, meta: role.agent_type });
          }
        }

        // Goals
        const goals = readJ(path.join(orgsDir, `${orgName}-goals.json`));
        for (const g of (goals?.goals || [])) {
          if (match(g.title) || match(g.text) || match(g.goal) || match(g.description)) {
            hits.push({ type: 'goal', id: g.id, title: g.title || g.text || g.goal, meta: g.status || 'open' });
          }
        }

        // Routines
        const routines = readJ(path.join(orgsDir, `${orgName}-routines.json`));
        for (const r of (routines?.routines || [])) {
          if (match(r.name) || match(r.description)) {
            hits.push({ type: 'routine', id: r.name, title: r.name, meta: r.schedule || '' });
          }
        }

        // Approvals
        const approvals = readJ(path.join(orgsDir, `${orgName}-approvals.json`));
        for (const a of (approvals?.approvals || [])) {
          if (match(a.title) || match(a.action) || match(a.agent_id)) {
            hits.push({ type: 'approval', id: a.id, title: a.title, meta: a.status });
          }
        }

        // Projects
        const projects = readJ(path.join(orgsDir, `${orgName}-projects.json`));
        for (const p of (projects?.projects || [])) {
          if (match(p.name) || match(p.description)) {
            hits.push({ type: 'project', id: p.id || p.name, title: p.name, meta: p.status || 'active' });
          }
        }

        // Issues
        const issuesData = readJ(path.join(orgsDir, `${orgName}-issues.json`));
        for (const i of (issuesData?.issues || [])) {
          if (match(i.title) || match(i.description) || match(i.slug)) {
            hits.push({ type: 'issue', id: i.id || i.slug, title: i.title || i.slug, meta: i.status || 'open' });
          }
        }

        // Recent activity events
        const eventsFile = path.join(d, 'data', 'mastermind-events.jsonl');
        if (fs.existsSync(eventsFile)) {
          const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).slice(-500);
          for (const l of lines) {
            try {
              const e = JSON.parse(l);
              if (e.org === orgName && match(JSON.stringify(e))) {
                hits.push({ type: 'event', id: String(e.ts), title: e.type, meta: e.role || e.task || '' });
                if (hits.length >= 50) break;
              }
            } catch(_) {}
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ q, hits: hits.slice(0, 50) }));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/issues — org task/issue list from issues file
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/issues$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _issuesQs = new URL(req.url, 'http://localhost').searchParams;
        const _issuesDir = path.resolve(_issuesQs.get('dir') || projectDir || process.cwd());
        const issuesPath = path.join(_issuesDir, '.monomind', 'orgs', `${orgName}-issues.json`);
        let payload = { issues: [] };
        try {
          const raw = JSON.parse(fs.readFileSync(issuesPath, 'utf8'));
          payload.issues = (raw.issues || []).map(i => ({
            id: i.id, slug: i.slug, title: i.title, description: i.description || null,
            status: i.status || 'open',
            priority: i.priority || 'medium', assignee_id: i.assignee_id || null,
            assignee: i.assignee || i.assignee_id || null,
            project_id: i.project_id || null, parent_id: i.parent_id || null,
            created_at: i.created_at, updated_at: i.updated_at
          }));
        } catch(_) { /* file missing is fine */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/health — aggregate org health metrics
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/health$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _healthQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_healthQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');

        let agentsRunning = 0, agentsIdle = 0, openIssues = 0, inProgressIssues = 0;
        let budgetUsedTokens = 0, budgetMaxTokens = 0;
        let successRuns = 0, totalRuns = 0;

        // State: agent statuses
        try {
          const state = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-state.json`), 'utf8'));
          const agents = state.agents || {};
          Object.values(agents).forEach(a => {
            if (a.status === 'running') agentsRunning++;
            else agentsIdle++;
            budgetUsedTokens += (a.tokens_used || ((a.tokens_in || 0) + (a.tokens_out || 0)));
          });
        } catch(_) {}

        // Budget cap from org config
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(base, `${orgName}.json`), 'utf8'));
          budgetMaxTokens = cfg.run_config?.budget_tokens || cfg.budget_tokens || 0;
        } catch(_) {}

        // Issues: open count
        try {
          const iss = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-issues.json`), 'utf8'));
          openIssues = (iss.issues || []).filter(i => i.status === 'open').length;
          inProgressIssues = (iss.issues || []).filter(i => i.status === 'in_progress').length;
        } catch(_) {}

        // Activity: 7-day success rate
        try {
          const actPath = path.join(base, `${orgName}-activity.jsonl`);
          const lines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
          const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
          lines.forEach(line => {
            try {
              const ev = JSON.parse(line);
              const evMs = typeof ev.ts === 'number' ? ev.ts : (ev.ts ? Date.parse(ev.ts) : 0);
              if (!evMs || evMs < cutoffMs) return;
              totalRuns++;
              if (ev.type && ev.type.includes('complete')) successRuns++;
            } catch(_) {}
          });
        } catch(_) {}

        const budgetUsedPct = budgetMaxTokens > 0 ? Math.round((budgetUsedTokens / budgetMaxTokens) * 100) : null;
        const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          agents_running: agentsRunning,
          agents_idle: agentsIdle,
          agents_active: agentsRunning,
          open_issues: openIssues,
          in_progress_issues: inProgressIssues,
          tasks_pending: openIssues + inProgressIssues,
          budget_used_tokens: budgetUsedTokens,
          budget_max_tokens: budgetMaxTokens,
          budget_used_pct: budgetUsedPct,
          run_success_rate_7d: successRate,
          total_runs_7d: totalRuns,
          errors: [],
        }));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/environments — org execution environments (strips key material)
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/environments$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _envsQs = new URL(req.url, 'http://localhost').searchParams;
        const envsPath = path.join(path.resolve(_envsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs', `${orgName}-environments.json`);
        let payload = { environments: [], default_env: null };
        try {
          const raw = JSON.parse(fs.readFileSync(envsPath, 'utf8'));
          // Strip any accidental key_material or private_key fields — never send to browser
          payload.default_env = raw.default_env || null;
          payload.environments = (raw.environments || []).map(e => {
            const safe = { ...e };
            delete safe.key_material;
            delete safe.private_key;
            delete safe.ssh_key;
            delete safe.password;
            return safe;
          });
        } catch(_) { /* file missing is fine — return empty */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/workspaces — org workspaces cross-referenced with worktree registry
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/workspaces$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _wsQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_wsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        let payload = { workspaces: [] };
        try {
          const wsRaw = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-workspaces.json`), 'utf8'));
          const workspaces = wsRaw.workspaces || [];
          // Optionally cross-reference worktree registry for branch/status enrichment
          let worktreeMap = {};
          try {
            const wtRaw = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-worktrees.json`), 'utf8'));
            (wtRaw.worktrees || []).forEach(wt => { worktreeMap[wt.path] = wt; });
          } catch(_) { /* no worktree registry, that's fine */ }
          payload.workspaces = workspaces.map(w => {
            const wt = w.worktree_path ? worktreeMap[w.worktree_path] : null;
            return wt ? { ...w, branch: w.branch || wt.branch || w.branch } : w;
          });
        } catch(_) { /* file missing is fine */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/invites — active invites + pending join requests
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/invites(\?.*)?$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _invitesQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_invitesQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        let payload = { invites: [], join_requests: [] };
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-members.json`), 'utf8'));
          const all = raw.join_requests || [];
          payload.invites = all.filter(r => r.type === 'invite' && r.status === 'pending')
            .map(r => ({ id: r.id, token: r.token ? r.token.slice(0, 8) + '…' : r.id, role: r.role || 'operator', createdAt: r.createdAt || null, expiresAt: r.expiresAt || null, status: r.status }));
          payload.join_requests = all.filter(r => r.type !== 'invite' && r.status === 'pending_approval')
            .map(r => ({ id: r.id, requestType: r.requestType || 'human', role: r.role || 'viewer', createdAt: r.createdAt || null, message: r.message || '' }));
        } catch(_) { /* members file missing */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/plugins — plugins from registry filtered/merged with org overrides
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/plugins$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _pluginsQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_pluginsQs.get('dir') || projectDir || process.cwd()), '.monomind');
        let plugins = [];
        try {
          const reg = JSON.parse(fs.readFileSync(path.join(base, 'plugins', 'registry.json'), 'utf8'));
          plugins = reg.plugins || [];
          // Strip sensitive config fields from output
          plugins = plugins.map(p => {
            const safe = { ...p };
            if (safe.config) {
              safe.config = Object.fromEntries(
                Object.entries(safe.config).map(([k, v]) =>
                  (/key|token|secret|password|api/i.test(k) ? [k, '***'] : [k, v])
                )
              );
            }
            return safe;
          });
        } catch(_) { /* no global registry */ }
        // Merge org-level overrides
        try {
          const orgPlugins = JSON.parse(fs.readFileSync(path.join(base, 'orgs', `${orgName}-plugins.json`), 'utf8'));
          const overrideMap = {};
          (orgPlugins.plugins || []).forEach(p => { overrideMap[p.id] = p; });
          if (Object.keys(overrideMap).length) {
            plugins = plugins.map(p => overrideMap[p.id] ? { ...p, ...overrideMap[p.id], _orgOverride: true } : p);
          }
        } catch(_) { /* no org-level overrides */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plugins }));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/my-issues — open + in_progress issues (self-assignable queue)
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/my-issues$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _myIssuesQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_myIssuesQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        let payload = { issues: [] };
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-issues.json`), 'utf8'));
          // Return open + in_progress issues — the "my issues" queue for the operator
          payload.issues = (raw.issues || [])
            .filter(i => i.status === 'open' || i.status === 'in_progress')
            .map(i => ({
              id: i.id,
              title: i.title || null,
              description: i.description || null,
              status: i.status || 'open',
              priority: i.priority || 'medium',
              assigneeId: i.assigneeId || i.assigned_to || null,
              projectId: i.projectId || i.project_id || null,
              createdAt: i.createdAt || null,
              lastActivityAt: i.lastActivityAt || null,
              updated_at: i.updated_at || i.lastActivityAt || i.updatedAt || i.ts || null,
              ts: i.ts || i.updated_at || i.lastActivityAt || null,
            }));
        } catch(_) { /* issues file missing */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/agents — agents from roles + merged heartbeat state
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/agents$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _agentsQs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(_agentsQs.get('dir') || projectDir || process.cwd());
        const base = path.join(d, '.monomind', 'orgs');
        const readJsonSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) { return null; } };
        const config = readJsonSafe(path.join(base, `${orgName}.json`)) || {};
        const stateData = readJsonSafe(path.join(base, `${orgName}-state.json`)) || {};
        const agentState = stateData.agents || stateData.roles
          ? (stateData.agents || Object.fromEntries((stateData.roles||[]).map(r => [r.id, r])))
          : {};
        const roles = config.roles || [];
        const agents = roles.map(r => {
          const s = agentState[r.id] || {};
          return {
            id: r.id,
            title: r.title || r.id,
            adapterType: r.agent_type || r.type || null,
            adapterModel: (r.adapter_config && r.adapter_config.model) || (r.adapter && r.adapter.model) || null,
            governance: r.governance || null,
            reportsTo: r.reports_to || null,
            status: s.status || 'idle',
            lastHeartbeat: s.last_heartbeat || s.lastHeartbeat || null,
            tokensIn: s.tokens_in || 0,
            tokensOut: s.tokens_out || 0,
            skills: r.skills || [],
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ agents }));
      } catch(_) { res.writeHead(500); res.end('{"agents":[]}'); }
      return;
    }

    // GET /api/org/:name/approvals — full approvals list with status filter support
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/approvals(\?.*)?$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _approvalsQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_approvalsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        const readJsonSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) { return null; } };
        const data = readJsonSafe(path.join(base, `${orgName}-approvals.json`)) || { approvals: [] };
        const approvals = (data.approvals || [])
          .sort((a, b) => new Date(b.createdAt || b.created_at || b.requested_at || 0) - new Date(a.createdAt || a.created_at || a.requested_at || 0))
          .map(a => ({
            id: a.id,
            title: a.title || a.action || null,
            action: a.action || a.title || null,
            description: a.description || a.action || a.title || null,
            status: a.status || 'pending',
            agentId: a.agentId || a.agent_id || null,
            agentTitle: a.agentTitle || null,
            requester: a.requester || a.agentTitle || a.agent_id || a.agentId || null,
            agent: a.agent || a.agent_id || a.agentId || null,
            payload: a.payload || null,
            risk_level: a.risk_level || 'medium',
            created_at: a.created_at || a.createdAt || a.requested_at || null,
            createdAt: a.createdAt || a.created_at || a.requested_at || null,
            updatedAt: a.updatedAt || null,
            resolvedAt: a.resolvedAt || null,
            resolvedBy: a.resolvedBy || null,
            ts: a.ts || null,
          }));
        const pending = approvals.filter(a => a.status === 'pending' || a.status === 'revision_requested').length;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ approvals, pending }));
      } catch(_) { res.writeHead(500); res.end('{"approvals":[],"pending":0}'); }
      return;
    }

    // POST /api/org/:name/approvals/:id — approve or reject a pending approval request
    // Body: { action: "approve" | "reject" | "revision_requested" }
    if (req.method === 'POST' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/approvals\/[^/]+$/i)) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2097152) { req.destroy(); break; } }
      try {
        const parts = url.split('/');
        const orgName = decodeURIComponent(parts[3]);
        const approvalId = decodeURIComponent(parts[5]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        if (!approvalId) { res.writeHead(400); res.end('{"error":"approval id required"}'); return; }
        const parsed = JSON.parse(body);
        const action = parsed.action;
        if (!['approve', 'reject', 'revision_requested'].includes(action)) {
          res.writeHead(400); res.end('{"error":"action must be approve, reject, or revision_requested"}'); return;
        }
        const _postApprovalsQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_postApprovalsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        const approvalsFile = path.join(base, `${orgName}-approvals.json`);
        let data = { approvals: [] };
        try { data = JSON.parse(fs.readFileSync(approvalsFile, 'utf8')); } catch(_) {}
        const idx = (data.approvals || []).findIndex(a => a.id === approvalId);
        if (idx === -1) { res.writeHead(404); res.end('{"error":"approval not found"}'); return; }
        const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revision_requested';
        data.approvals[idx] = {
          ...data.approvals[idx],
          status,
          resolvedAt: new Date().toISOString(),
          resolvedBy: 'operator',
        };
        const tmp = `${approvalsFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmp, approvalsFile);
        // Emit org:approval:resolved event so boss agent unblocks
        const event = { type: 'org:approval:resolved', org: orgName, approval_id: approvalId, status, ts: Date.now() };
        appendToFile(path.join(path.resolve(_postApprovalsQs.get('dir') || projectDir || process.cwd()), 'data', 'mastermind-events.jsonl'), JSON.stringify(event) + '\n').catch(() => {});
        broadcastMm(event);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, status }));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // GET /api/org/:name/secrets — masked secrets list (NEVER exposes values)
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/secrets$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _secretsQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_secretsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        const secretsDir = path.join(base, '.secrets');
        const readJsonSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(_) { return null; } };
        // Read secrets index — NEVER expose actual values
        const indexFile = path.join(secretsDir, `${orgName}-index.json`);
        const data = readJsonSafe(indexFile) || { secrets: [] };
        const secrets = (data.secrets || []).map(s => ({
          name: s.name,
          purpose: s.purpose || null,
          maskedRef: s.maskedRef || `${(s.name||'').substring(0,4)}***`,
          status: s.status || 'active',
          createdAt: s.createdAt || null,
          rotatedAt: s.rotatedAt || null,
          lastUsedAt: s.lastUsedAt || null,
          usageCount: s.usageCount || 0,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ secrets }));
      } catch(_) { res.writeHead(500); res.end('{"secrets":[]}'); }
      return;
    }

    // GET /api/org/:name/budgets — org and per-agent budget data
    // Returns: { org_budget: {limit_tokens, limit_usd}, agent_budgets: {agentId: {limit_usd}}, agents: [{id, title, tokens_in, tokens_out, total_cost_usd}] }
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/budgets$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _budgetsQs = new URL(req.url, 'http://localhost').searchParams;
        const base = path.join(path.resolve(_budgetsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        let budgetData = { org_budget: {}, agent_budgets: {}, period: 'monthly', currency: 'USD' };
        try { budgetData = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-budgets.json`), 'utf8')); } catch(_) {}
        // Enrich with per-agent spend from state file.
        // State file format: { agents: { "<role_id>": { tokens_in, tokens_out, ... } } }
        let agents = [];
        try {
          const state = JSON.parse(fs.readFileSync(path.join(base, `${orgName}-state.json`), 'utf8'));
          const agentMap = state.agents || {};
          // Also load role titles from org config for enrichment
          let roleMap = {};
          try {
            const cfg = JSON.parse(fs.readFileSync(path.join(base, `${orgName}.json`), 'utf8'));
            (cfg.roles || []).forEach(r => { roleMap[r.id] = r.title || r.id; });
          } catch(_) {}
          agents = Object.entries(agentMap).map(([id, s]) => ({
            id,
            title: roleMap[id] || s.title || id,
            tokens_in: s.tokens_in || 0,
            tokens_out: s.tokens_out || 0,
            tokens_used: s.tokens_used || (s.tokens_in || 0) + (s.tokens_out || 0),
            total_cost_usd: s.total_cost_usd || 0,
          }));
        } catch(_) {}
        // Scan org run jsonl files for agent:usage events (fallback when state.json has no token data)
        const _hasTokenData = agents.some(a => a.tokens_in > 0 || a.tokens_out > 0 || a.total_cost_usd > 0);
        if (!_hasTokenData) {
          try {
            const _runsDir = path.join(base, orgName, 'runs');
            if (fs.existsSync(_runsDir)) {
              const _usageByRole = {};
              for (const f of fs.readdirSync(_runsDir)) {
                if (!f.endsWith('.jsonl')) continue;
                const lines = fs.readFileSync(path.join(_runsDir, f), 'utf8').split('\n').filter(Boolean);
                for (const l of lines) {
                  try {
                    const ev = JSON.parse(l);
                    if (ev.type === 'agent:usage' && ev.role) {
                      const role = String(ev.role).trim();
                      if (!_usageByRole[role]) _usageByRole[role] = { tokens_in: 0, tokens_out: 0, total_cost_usd: 0 };
                      _usageByRole[role].tokens_in += Number(ev.tokens_in) || 0;
                      _usageByRole[role].tokens_out += Number(ev.tokens_out) || 0;
                      _usageByRole[role].total_cost_usd += Number(ev.cost_usd) || 0;
                    }
                  } catch(_) {}
                }
              }
              if (Object.keys(_usageByRole).length > 0) {
                // Merge usage into agents list; preserve role titles
                agents = agents.map(a => {
                  const u = _usageByRole[a.id] || {};
                  return { ...a, tokens_in: u.tokens_in || 0, tokens_out: u.tokens_out || 0, total_cost_usd: u.total_cost_usd || 0 };
                });
                // Add any roles that appeared in events but aren't in config
                for (const [role, u] of Object.entries(_usageByRole)) {
                  if (!agents.find(a => a.id === role)) agents.push({ id: role, title: role, ...u });
                }
              }
            }
          } catch(_) {}
        }
        // Do NOT fall back to zero-value role stubs — empty agents array is the honest signal
        // that no usage has been tracked yet; the UI shows "No cost data" rather than $0.0000 rows.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...budgetData, agents }));
      } catch(_) { res.writeHead(500); res.end('{"org_budget":{},"agent_budgets":{},"agents":[]}'); }
      return;
    }

    // GET /api/org/:name/threads — conversation threads from threads.jsonl
    // Returns: { threads: [{id, subject, authorId, authorName, issueId, createdAt, messages:[]}] }
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/threads$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _threadsQs = new URL(req.url, 'http://localhost').searchParams;
        const _threadsRoot = path.resolve(_threadsQs.get('dir') || projectDir || process.cwd());
        const _threadsProjDir = _resolveOrgProjectDir(orgName, _threadsRoot) || _threadsRoot;
        const threadsFile = path.join(_threadsProjDir, '.monomind', 'orgs', `${orgName}-threads.jsonl`);
        let threads = [];
        try {
          const lines = fs.readFileSync(threadsFile, 'utf8').split('\n').filter(l => l.trim());
          threads = lines.map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
          // Group 'message' entries (from org:comms) by run_id into synthetic thread objects
          const msgsByRun = {};
          threads.filter(t => t.type === 'message').forEach(m => {
            const rid = m.run_id || 'unknown';
            if (!msgsByRun[rid]) msgsByRun[rid] = { id: `thread-${rid}`, type: 'thread', subject: `Run ${rid}`, run_id: rid, createdAt: m.ts, messages: [] };
            msgsByRun[rid].messages.push({ from: m.from, to: m.to, msg: m.msg, ts: m.ts });
          });
          const syntheticThreads = Object.values(msgsByRun).map(t => ({ ...t, messageCount: t.messages.length, author: t.messages[0]?.from || null }));
          threads = threads.filter(t => t.type === 'thread' || !t.type).map(t => ({
            ...t,
            author: t.author || t.authorName || t.createdBy || t.authorId || null,
            messageCount: t.messageCount != null ? t.messageCount : (Array.isArray(t.messages) ? t.messages.length : (typeof t.messages === 'number' ? t.messages : null)),
          }));
          threads = [...threads, ...syntheticThreads];
        } catch(_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ threads }));
      } catch(_) { res.writeHead(500); res.end('{"threads":[]}'); }
      return;
    }

    // GET /api/org/:name/join-requests — pending join requests for this org
    // Returns: { requests: [{id, requesterId, requesterName, type, status, createdAt, resolvedAt}], pending: N }
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/join-requests(\?.*)?$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _joinQs = new URL(req.url, 'http://localhost').searchParams;
        const joinFile = path.join(path.resolve(_joinQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs', `${orgName}-join-requests.json`);
        let requests = [];
        try {
          const raw = fs.readFileSync(joinFile, 'utf8');
          const data = JSON.parse(raw);
          requests = (data.requests || []).map(r => ({
            id: r.id,
            requesterId: r.requesterId,
            requesterName: r.requesterName || r.requesterId,
            type: r.type || 'human',
            status: r.status || 'pending_approval',
            createdAt: r.createdAt,
            resolvedAt: r.resolvedAt || null,
          }));
        } catch(_) {}
        const pending = requests.filter(r => r.status === 'pending_approval').length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ requests, pending }));
      } catch(_) { res.writeHead(500); res.end('{"requests":[],"pending":0}'); }
      return;
    }

    // GET /api/org/:name/goals — read org goals
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/goals$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _goalsQs = new URL(req.url, 'http://localhost').searchParams;
        const _goalsRoot = path.resolve(_goalsQs.get('dir') || projectDir || process.cwd());
        const _goalsProjDir = _resolveOrgProjectDir(orgName, _goalsRoot) || _goalsRoot;
        const goalsFile = path.join(_goalsProjDir, '.monomind', 'orgs', `${orgName}-goals.json`);
        let data = { goals: [] };
        try { data = JSON.parse(fs.readFileSync(goalsFile, 'utf8')); } catch(_) {}
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ goals: data.goals || [] }));
      } catch(_) { res.writeHead(500); res.end('{"goals":[]}'); }
      return;
    }

    // GET /api/org/:name/routines — read org routines (falls back to synthesizing from org config's loop object)
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/routines$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _routinesQs = new URL(req.url, 'http://localhost').searchParams;
        const _routinesBase = path.resolve(_routinesQs.get('dir') || projectDir || process.cwd());
        const _routinesProjDir = _resolveOrgProjectDir(orgName, _routinesBase) || _routinesBase;
        const routinesFile = path.join(_routinesProjDir, '.monomind', 'orgs', `${orgName}-routines.json`);
        let data = { routines: [] };
        try { data = JSON.parse(fs.readFileSync(routinesFile, 'utf8')); } catch(_) {}
        // Synthesize routines from org config's loop/schedule settings when no explicit routines are defined
        if (!data.routines || !data.routines.length) {
          try {
            const orgCfg = JSON.parse(fs.readFileSync(path.join(_routinesProjDir, '.monomind', 'orgs', `${orgName}.json`), 'utf8'));
            const loop = orgCfg.loop;
            if (loop && (loop.poll_interval_minutes || loop.interval_minutes)) {
              const intervalMin = loop.poll_interval_minutes || loop.interval_minutes;
              data.routines = [{
                name: `${orgName}-cycle`,
                description: orgCfg.goal ? orgCfg.goal.slice(0, 120) : 'Org iteration cycle',
                schedule: `every ${intervalMin}m`,
                cron: null,
                enabled: orgCfg.status === 'active',
                status: orgCfg.status || 'stopped',
                prompt_file: loop.run_prompt_file || null,
                source: 'loop-config',
                lastRun: null,
              }];
            } else if (orgCfg.schedule) {
              data.routines = [{
                name: `${orgName}-schedule`,
                description: orgCfg.goal ? orgCfg.goal.slice(0, 120) : 'Org scheduled run',
                schedule: String(orgCfg.schedule),
                cron: null,
                enabled: orgCfg.status === 'active',
                status: orgCfg.status || 'stopped',
                source: 'schedule-config',
                lastRun: null,
              }];
            }
          } catch(_) {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ routines: data.routines || [] }));
      } catch(_) { res.writeHead(500); res.end('{"routines":[]}'); }
      return;
    }

    // POST /api/org/:name/goals — upsert the org goals file
    // Body: { goals: [{id, title, description, status, priority, assignee_id, created_at}] }
    if (req.method === 'POST' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/goals$/i)) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2097152) { req.destroy(); break; } }
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const parsed = JSON.parse(body);
        if (!parsed || !Array.isArray(parsed.goals)) { res.writeHead(400); res.end('{"error":"goals array required"}'); return; }
        const _postGoalsQs = new URL(req.url, 'http://localhost').searchParams;
        const goalsFile = path.join(path.resolve(_postGoalsQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs', `${orgName}-goals.json`);
        const tmp = `${goalsFile}.tmp`;
        const payload = { org: orgName, updated_at: new Date().toISOString(), goals: parsed.goals };
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
        fs.renameSync(tmp, goalsFile);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, count: parsed.goals.length }));
      } catch(_) { res.writeHead(500); res.end('{"error":"' + String(_).replace(/"/g, '\\"') + '"}'); }
      return;
    }

    // POST /api/org/:name/routines — upsert the org routines file
    // Body: { routines: [{name, description, schedule, enabled, last_run, next_run}] }
    if (req.method === 'POST' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/routines$/i)) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2097152) { req.destroy(); break; } }
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const parsed = JSON.parse(body);
        if (!parsed || !Array.isArray(parsed.routines)) { res.writeHead(400); res.end('{"error":"routines array required"}'); return; }
        const _postRoutinesQs = new URL(req.url, 'http://localhost').searchParams;
        const routinesFile = path.join(path.resolve(_postRoutinesQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs', `${orgName}-routines.json`);
        const tmp = `${routinesFile}.tmp`;
        const payload = { org: orgName, updated_at: new Date().toISOString(), routines: parsed.routines };
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
        fs.renameSync(tmp, routinesFile);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, count: parsed.routines.length }));
      } catch(_) { res.writeHead(500); res.end('{"error":"' + String(_).replace(/"/g, '\\"') + '"}'); }
      return;
    }

    // GET /api/org/:name/files — all files related to an org
    if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/files$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('{"error":"Invalid org name"}'); return; }
        const _filesQs = new URL(req.url, 'http://localhost').searchParams;
        const d = path.resolve(_filesQs.get('dir') || projectDir || process.cwd());
        const orgsDir = path.join(d, '.monomind', 'orgs');
        const files = [];
        const seen = new Set();
        const addFile = (fp, type) => {
          if (seen.has(fp)) return; seen.add(fp);
          try { const st = fs.statSync(fp); files.push({ name: path.basename(fp), path: fp, type, size: st.size, mtime: st.mtime.toISOString() }); } catch (_) {}
        };
        addFile(path.join(orgsDir, orgName + '.json'), 'config');
        for (const s of ['-state','-approvals','-goals','-routines','-projects','-members','-issues','-threads','-budgets']) {
          const fp = path.join(orgsDir, orgName + s + '.json');
          if (fs.existsSync(fp)) addFile(fp, s.slice(1));
        }
        const walkDir = (dir, depth) => {
          if (depth > 3) return;
          let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
          for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) walkDir(fp, depth + 1);
            else addFile(fp, 'generated');
          }
        };
        const orgWorkDir = path.join(orgsDir, orgName);
        if (fs.existsSync(orgWorkDir)) walkDir(orgWorkDir, 0);
        let orgCfg = null;
        try { orgCfg = JSON.parse(fs.readFileSync(path.join(orgsDir, orgName + '.json'), 'utf8')); } catch (_) {}
        if (orgCfg && Array.isArray(orgCfg.roles)) {
          const agentsDir = path.join(d, '.claude', 'agents');
          const walkAgents = (dir) => {
            let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
            for (const e of entries) {
              if (e.isDirectory()) { walkAgents(path.join(dir, e.name)); continue; }
              if (!e.name.endsWith('.md')) continue;
              const fp = path.join(dir, e.name);
              const base = e.name.replace('.md', '').toLowerCase();
              if (orgCfg.roles.some(r => base === (r.id||'').toLowerCase() || base === (r.agent_type||'').toLowerCase() || (r.instructions_file||'').endsWith(e.name))) addFile(fp, 'agent-definition');
            }
          };
          if (fs.existsSync(agentsDir)) walkAgents(agentsDir);
        }
        files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(files));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // GET /api/file-content — return raw text content of a .monomind file
    if (req.method === 'GET' && url === '/api/file-content') {
      try {
        const _fcQs = new URL(req.url, 'http://localhost').searchParams;
        const rawPath = _fcQs.get('path');
        const baseDir = path.resolve(_fcQs.get('dir') || projectDir || process.cwd());
        if (!rawPath) { res.writeHead(400); res.end('Missing path'); return; }
        const resolved = path.resolve(rawPath);
        // Security: must be inside .monomind of the project dir
        const monomindDir = path.join(baseDir, '.monomind');
        if (!resolved.startsWith(monomindDir + path.sep) && resolved !== monomindDir) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        if (!fs.existsSync(resolved)) { res.writeHead(404); res.end('Not found'); return; }
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) { res.writeHead(400); res.end('Not a file'); return; }
        if (stat.size > 524288) { res.writeHead(413); res.end('File too large'); return; }
        const content = fs.readFileSync(resolved, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(content);
      } catch(_) { res.writeHead(500); res.end('Internal error'); }
      return;
    }

    // DELETE /api/orgs/:name — delete an org config and all associated data files
    if (req.method === 'DELETE' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}(\?.*)?$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _delOrgQs = new URL(req.url, 'http://localhost').searchParams;
        const orgsDir = path.join(path.resolve(_delOrgQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        const configFile = path.join(orgsDir, `${orgName}.json`);
        if (!fs.existsSync(configFile)) { res.writeHead(404); res.end('{"error":"org not found"}'); return; }
        // Remove all org-associated files (config + state + data)
        const suffixes = ['', '-state', '-goals', '-routines', '-approvals', '-activity', '-issues', '-members', '-projects', '-workspaces', '-worktrees', '-environments', '-plugins', '-adapters', '-budgets', '-threads', '-secrets', '-join-requests', '-bootstrap', '-project-workspaces', '-approval-comments', '-skills'];
        for (const suf of suffixes) {
          const f = path.join(orgsDir, `${orgName}${suf}.json`);
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(_) {}
          const fjsonl = path.join(orgsDir, `${orgName}${suf}.jsonl`);
          try { if (fs.existsSync(fjsonl)) fs.unlinkSync(fjsonl); } catch(_) {}
        }
        // Remove stop file if present
        try { fs.unlinkSync(path.join(orgsDir, '.stops', `${orgName}.stop`)); } catch(_) {}
        // Remove org subdirectory under .monomind/orgs/ (legacy flat-file location)
        try { const orgWorkDir = path.join(orgsDir, orgName); if (fs.existsSync(orgWorkDir)) fs.rmSync(orgWorkDir, { recursive: true, force: true }); } catch(_) {}
        // Remove org subdirectory under git-safe location (.git/monomind/orgs/<name>/) so run
        // files written by the worktree-aware path (feat 880f034e) are also cleaned up on delete
        try {
          const _delWorkDir = path.resolve(_delOrgQs.get('dir') || projectDir || process.cwd());
          const _delGitMonoDir = _getGitMonomindDir(_delWorkDir);
          if (_delGitMonoDir) {
            const gitOrgDir = path.join(_delGitMonoDir, 'orgs', orgName);
            if (fs.existsSync(gitOrgDir)) fs.rmSync(gitOrgDir, { recursive: true, force: true });
          }
        } catch(_) {}
        // Remove loop prompt file if present (created for scheduled orgs by createorg)
        try { const lpf = path.join(path.resolve(projectDir || process.cwd()), '.monomind', 'loops', `${orgName}.md`); if (fs.existsSync(lpf)) fs.unlinkSync(lpf); } catch(_) {}
        // Emit org:delete event
        const deleteEvent = { type: 'org:delete', org: orgName, ts: Date.now() };
        appendToFile(path.join(projectDir || process.cwd(), 'data', 'mastermind-events.jsonl'), JSON.stringify(deleteEvent) + '\n').catch(() => {});
        broadcastMm(deleteEvent);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end('{"ok":true}');
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // POST /api/orgs/:name/stop — send stop signal to a running org
    if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/stop$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const _stopOrgQs = new URL(req.url, 'http://localhost').searchParams;
        const _stopOrgBase = path.resolve(_stopOrgQs.get('dir') || projectDir || process.cwd());
        const stopEvent = { type: 'org:stop', org: orgName, ts: Date.now() };
        const dataDir = path.join(_stopOrgBase, 'data');
        try { fs.mkdirSync(dataDir, { recursive: true }); } catch(_) {}
        appendToFile(path.join(dataDir, 'mastermind-events.jsonl'), JSON.stringify(stopEvent) + '\n').catch(() => {});
        // Write stop marker file for boss agent to detect
        try {
          const stopDir = path.join(_stopOrgBase, '.monomind', 'orgs', '.stops');
          fs.mkdirSync(stopDir, { recursive: true });
          fs.writeFileSync(path.join(stopDir, `${orgName}.stop`), String(Date.now()));
        } catch(_) {}
        broadcastMm(stopEvent);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end('{"ok":true}');
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // POST /api/orgs/:name/copy — copy org config to another project directory
    if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/copy$/i)) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2097152) { req.destroy(); break; } }
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid org name' })); return; }
        let payload = {};
        try { payload = JSON.parse(body); } catch(_) {}
        const destination = payload.destination ? String(payload.destination).trim() : '';
        if (!destination) { res.writeHead(400); res.end(JSON.stringify({ error: 'destination is required' })); return; }
        if (!path.isAbsolute(destination)) { res.writeHead(400); res.end(JSON.stringify({ error: 'destination must be an absolute path' })); return; }
        const _copyOrgQs = new URL(req.url, 'http://localhost').searchParams;
        const srcOrgsDir = path.join(path.resolve(_copyOrgQs.get('dir') || projectDir || process.cwd()), '.monomind', 'orgs');
        const srcFile = path.join(srcOrgsDir, `${orgName}.json`);
        if (!fs.existsSync(srcFile)) { res.writeHead(404); res.end(JSON.stringify({ error: 'org not found' })); return; }
        const destOrgsDir = path.join(path.resolve(destination), '.monomind', 'orgs');
        try { fs.mkdirSync(destOrgsDir, { recursive: true }); } catch(_) {}
        const destFile = path.join(destOrgsDir, `${orgName}.json`);
        fs.copyFileSync(srcFile, destFile);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, destFile }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e.message || e) })); }
      return;
    }

    // GET /api/org/:name/runs — list structured run files for an org
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runs(\?.*)?$/i.test(url)) {
      try {
        const _rQs = new URL(req.url, 'http://localhost').searchParams;
        const _rOrgName = decodeURIComponent(url.split('/')[3] || '');
        if (_rOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_rOrgName)) { res.writeHead(400); res.end('{"error":"Invalid org name"}'); return; }
        const _rExplicitDir = _rQs.get('dir');
        const _rServerRoot = path.resolve(_rExplicitDir || projectDir || process.cwd());
        // Search across known projects (same logic as /api/orgs) unless explicit dir given
        const _rProjDirs = new Set([_rServerRoot]);
        if (!_rExplicitDir) {
          try {
            const _rKnown = JSON.parse(fs.readFileSync(path.join(_rServerRoot, 'data', 'known-projects.json'), 'utf8'));
            _rKnown.forEach(p => _rProjDirs.add(p));
          } catch(_) {}
        }
        const _rSeenFiles = new Set();
        const runs = [];
        const _parseRun = (filePath, f) => {
          try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const allLines = raw.split('\n').filter(Boolean);
            const parse = l => { try { return JSON.parse(l); } catch { return null; } };
            // Merge .warm.jsonl (promoted pre-complete events) for accurate event count + metadata
            const warmFile = filePath.replace(/\.jsonl$/, '.warm.jsonl');
            let warmLines = [];
            let warmEvents = [];
            try { if (fs.existsSync(warmFile)) { warmLines = fs.readFileSync(warmFile, 'utf8').split('\n').filter(Boolean); warmEvents = warmLines.map(parse).filter(Boolean); } } catch(_) {}
            const combinedLines = [...warmLines, ...allLines];
            const eventCount = combinedLines.length;
            const headEvents = (warmEvents.length ? warmEvents : allLines.map(parse).filter(Boolean)).slice(0, 10);
            const tailEvents = (allLines.map(parse).filter(Boolean).slice(-5).length ? allLines.map(parse).filter(Boolean).slice(-5) : warmEvents.slice(-5));
            const first = headEvents.find(e => e.type === 'run:start') || headEvents[0];
            const last = [...(warmEvents.slice(-5)), ...(allLines.map(parse).filter(Boolean).slice(-3))].slice().reverse().find(e => e.type === 'run:complete' || e.type === 'org:complete');
            const cycles = combinedLines.filter(l => l.includes('"org:checkpoint"')).length;
            const lastEvent = allLines.map(parse).filter(Boolean).slice(-1)[0] || warmEvents.slice(-1)[0];
            const ageMs = lastEvent?.ts ? Date.now() - lastEvent.ts : Infinity;
            const isStale = !last && ageMs > 30 * 60 * 1000;
            const firstBossComms = headEvents.find(e => e.type === 'org:comms' && (e.from === 'boss' || e.role === 'boss') && e.msg);
            const derivedGoal = first?.goal || firstBossComms?.msg?.slice(0, 80) || '';
            return { runId: f.replace('.jsonl', ''), startedAt: first?.ts || 0, endedAt: last?.ts || 0,
              status: last ? 'complete' : isStale ? 'stale' : 'running',
              eventCount, cycleCount: cycles, goal: derivedGoal, bossRole: first?.bossRole || '' };
          } catch(_) { return null; }
        };
        for (const _rpd of _rProjDirs) {
          // Check both .monomind and .git/monomind locations
          const _rMonoDir = _getGitMonomindDir(_rpd) || path.join(_rpd, '.monomind');
          const _rSearchDirs = [path.join(_rMonoDir, 'orgs', _rOrgName, 'runs')];
          if (_rMonoDir !== path.join(_rpd, '.monomind')) _rSearchDirs.push(path.join(_rpd, '.monomind', 'orgs', _rOrgName, 'runs'));
          for (const _rDir of _rSearchDirs) {
            if (!fs.existsSync(_rDir)) continue;
            const files = fs.readdirSync(_rDir).filter(f => f.endsWith('.jsonl') && !f.endsWith('.convs.jsonl') && !f.endsWith('.warm.jsonl') && !f.endsWith('.cold.jsonl')).sort().reverse();
            for (const f of files.slice(0, 50)) {
              if (_rSeenFiles.has(f)) continue;
              _rSeenFiles.add(f);
              const r = _parseRun(path.join(_rDir, f), f);
              if (r) runs.push(r);
            }
          }
        }
        runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(runs));
      } catch (_) { res.writeHead(500); res.end('[]'); }
      return;
    }

    // GET /api/org/:name/runs/:runId — get all events for a specific run
    if (req.method === 'GET' && /^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/runs\/[a-z0-9][a-z0-9_-]{0,79}(\?.*)?$/i.test(url)) {
      try {
        const _rvQs = new URL(req.url, 'http://localhost').searchParams;
        const _rvParts = url.replace(/\?.*$/, '').split('/');
        const _rvOrgName = decodeURIComponent(_rvParts[3] || '');
        const _rvRunId = decodeURIComponent(_rvParts[5] || '');
        if (_rvOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_rvOrgName) ||
            _rvRunId.length > 80  || !/^[a-z0-9][a-z0-9_-]*$/i.test(_rvRunId)) { res.writeHead(400); res.end('{"error":"Invalid org or run id"}'); return; }
        const _rvExplicitDir = _rvQs.get('dir');
        const _rvServerRoot = path.resolve(_rvExplicitDir || projectDir || process.cwd());
        // Search across known projects
        const _rvProjDirs = new Set([_rvServerRoot]);
        if (!_rvExplicitDir) {
          try {
            JSON.parse(fs.readFileSync(path.join(_rvServerRoot, 'data', 'known-projects.json'), 'utf8')).forEach(p => _rvProjDirs.add(p));
          } catch(_) {}
        }
        let _rvFile = null;
        for (const _rvpd of _rvProjDirs) {
          const _rvMonoDir = _getGitMonomindDir(_rvpd) || path.join(_rvpd, '.monomind');
          const _candidates = [path.join(_rvMonoDir, 'orgs', _rvOrgName, 'runs', `${_rvRunId}.jsonl`)];
          if (_rvMonoDir !== path.join(_rvpd, '.monomind')) _candidates.push(path.join(_rvpd, '.monomind', 'orgs', _rvOrgName, 'runs', `${_rvRunId}.jsonl`));
          for (const c of _candidates) { if (fs.existsSync(c)) { _rvFile = c; break; } }
          if (_rvFile) break;
        }
        if (!_rvFile) { res.writeHead(404); res.end('{"error":"run not found"}'); return; }
        const _parseLines = p => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
        const events = _parseLines(_rvFile);
        // Merge .warm.jsonl (pre-run:complete events, including org:comms) if it exists.
        // When run:complete fires, the hot .jsonl is renamed to .warm.jsonl so all pre-complete
        // events live there. The current .jsonl then only holds post-complete events (e.g. org:stop).
        const _rvWarmFile = _rvFile.replace(/\.jsonl$/, '.warm.jsonl');
        if (fs.existsSync(_rvWarmFile)) {
          events.push(..._parseLines(_rvWarmFile));
        }
        // For in-progress runs (no .warm.jsonl), org:comms also go to .convs.jsonl (stripped form).
        // They're already in .jsonl as full events, so .convs.jsonl would duplicate — skip it.
        events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(events));
      } catch (_) { res.writeHead(500); res.end('[]'); }
      return;
    }

    // GET /api/org/:name/artifact — serve file content for chat "View" button
    if (req.method === 'GET' && /^\/api\/org\/[^/]+\/artifact/.test(url)) {
      try {
        const _artQp = new URL('http://x' + req.url).searchParams;
        const _rawPath = _artQp.get('path');
        if (!_rawPath) { res.writeHead(400); res.end(JSON.stringify({ error: 'path required' })); return; }
        const _filePath = path.resolve(decodeURIComponent(_rawPath));
        // Path traversal guard: only allow reads within known project dirs
        const _allowed = _getAllowedArtifactDirs(projectDir || process.cwd());
        const _safe = _allowed.some(d => _filePath.startsWith(d + path.sep) || _filePath === d);
        if (!_safe) { res.writeHead(403); res.end(JSON.stringify({ error: 'path not allowed' })); return; }
        if (!fs.existsSync(_filePath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'file not found' })); return; }
        const _mime = _detectMimeType(_filePath);
        const _size = fs.statSync(_filePath).size;
        // Reject files >2MB to avoid blocking the event loop
        if (_size > 2 * 1024 * 1024) { res.writeHead(413); res.end(JSON.stringify({ error: 'file too large', size: _size })); return; }
        if (!_mime.startsWith('text/') && _mime !== 'application/json') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ binary: true, mimeType: _mime, size: _size }));
          return;
        }
        const _content = fs.readFileSync(_filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ content: _content, mimeType: _mime, size: _size }));
      } catch (_e) { res.writeHead(500); res.end(JSON.stringify({ error: 'read failed' })); }
      return;
    }

    // ------------------------------------------------- Mastermind event system
    // POST /api/mastermind/event — ingest event from mastermind skill
    if (req.method === 'POST' && url === '/api/mastermind/event') {
      return handleMastermindEvent(req, res);
    }

    // GET /api/mastermind-stream — SSE for real-time events
    if (req.method === 'GET' && url === '/api/mastermind-stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      addMmClient(res);
      // Replay last 50 events from disk (use ?project= param if provided)
      try {
        const _sseQp = new URL('http://x' + req.url).searchParams;
        const _sseProj = _sseQp.get('project');
        const root2 = _sseProj || projectDir || process.cwd();
        const evFile = path.join(root2, 'data', 'mastermind-events.jsonl');
        const lines = fs.readFileSync(evFile, 'utf8').trim().split('\n').filter(Boolean).slice(-50);
        for (const l of lines) res.write(`data: ${l}\n\n`);
      } catch (_) {}
      const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { clearInterval(ka); removeMmClient(res); } }, 20000);
      req.on('close', () => { removeMmClient(res); clearInterval(ka); });
      return;
    }

    // GET /api/mastermind/sessions
    if (req.method === 'GET' && url.startsWith('/api/mastermind/sessions')) {
      try {
        const qp = new URL('http://x' + req.url).searchParams;
        const filterProject = qp.get('project');
        const limitParam = Math.min(parseInt(qp.get('limit') || '200', 10) || 200, 500);
        const serverRoot = projectDir || process.cwd();
        // Collect all project dirs to aggregate
        const projectDirs = new Set([serverRoot]);
        try {
          const known = JSON.parse(fs.readFileSync(path.join(serverRoot, 'data', 'known-projects.json'), 'utf8'));
          known.forEach(p => projectDirs.add(p));
        } catch (_) {}
        let allSessions = [];
        for (const pd of projectDirs) {
          if (filterProject && pd !== filterProject) continue;
          const sessDir = path.join(pd, 'data', 'sessions');
          const indexFile = path.join(sessDir, '_index.json');
          // ── New format: per-session JSONL + _index.json ──
          if (fs.existsSync(indexFile)) {
            try {
              const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
              const top = idx.slice(0, limitParam);
              for (const entry of top) {
                const _sid = String(entry.id || '').trim();
                if (!_sid || !/^(?!.*\.\.)[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(_sid)) continue;
                let events = [];
                try {
                  const jl = fs.readFileSync(path.join(sessDir, `${_sid}.jsonl`), 'utf8');
                  events = jl.trim().split('\n').filter(Boolean)
                    .map(l => { try { return JSON.parse(l); } catch { return null; } })
                    .filter(Boolean);
                } catch(_) {}
                allSessions.push({ ...entry, events, project: pd });
              }
            } catch(_) {}
          } else {
            // ── Legacy fallback: mastermind-sessions.json ──
            const f = path.join(pd, 'data', 'mastermind-sessions.json');
            if (fs.existsSync(f)) {
              try {
                const s = JSON.parse(fs.readFileSync(f, 'utf8'));
                s.forEach(sess => { if (!sess.project) sess.project = pd; });
                allSessions = allSessions.concat(s);
              } catch (_) {}
            }
          }
        }
        allSessions.sort((a,b) => (b.ts||b.startedAt||0)-(a.ts||a.startedAt||0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(allSessions.slice(0, limitParam)));
      } catch (_) { res.writeHead(200); res.end('[]'); }
      return;
    }

    // GET /api/mastermind/session/:id/trace — human-readable markdown trace
    if (req.method === 'GET' && url.match(/^\/api\/mastermind\/session\/[^/]+\/trace$/)) {
      try {
        const sid = url.split('/')[4];
        const sessFile = path.join(projectDir || process.cwd(), 'data', 'sessions', `${sid}.json`);
        let s = null;
        if (fs.existsSync(sessFile)) {
          s = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
        } else {
          const f = path.join(projectDir || process.cwd(), 'data', 'mastermind-sessions.json');
          const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
          s = sessions.find(x => x.id === sid);
        }
        if (!s) { res.writeHead(404); res.end('Session not found'); return; }
        const fmt = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const lines = [`# Mastermind Session Trace: ${s.id}`, ``, `**Prompt:** ${s.prompt || '(none)'}`, `**Status:** ${s.status}`, `**Started:** ${fmt(s.ts)}`, s.endTs ? `**Ended:** ${fmt(s.endTs)}` : '', `**Domains:** ${(s.domains || []).join(', ') || '(none yet)'}`, ``];
        for (const ev of (s.events || [])) {
          const t = fmt(ev.ts);
          if (ev.type === 'session:start')    lines.push(`\`${t}\` **SESSION START** — prompt: "${ev.prompt || ''}"`);
          else if (ev.type === 'domain:dispatch') lines.push(`\`${t}\` **DOMAIN DISPATCH** → \`${ev.domain}\` — ${ev.cmd || ''}`);
          else if (ev.type === 'agent:spawn')  lines.push(`\`${t}\` **AGENT SPAWN** [\`${ev.domain}\`] → agent: \`${ev.agent}\` — ${ev.task || ''}`);
          else if (ev.type === 'intercom')     lines.push(`\`${t}\` **INTERCOM** \`${ev.from}\` → \`${ev.to}\`: ${ev.msg || ''}`);
          else if (ev.type === 'domain:complete') lines.push(`\`${t}\` **DOMAIN COMPLETE** [\`${ev.domain}\`] status: ${ev.status}${ev.artifacts?.length ? ` — artifacts: ${ev.artifacts.join(', ')}` : ''}`);
          else if (ev.type === 'session:complete') lines.push(`\`${t}\` **SESSION COMPLETE** — status: ${ev.status}, domains: ${(ev.domains || []).join(', ')}`);
          else lines.push(`\`${t}\` ${ev.type} ${JSON.stringify(ev)}`);
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(lines.join('\n'));
      } catch (_) { res.writeHead(500); res.end('Error'); }
      return;
    }

    // GET /api/mastermind/session/:id
    if (req.method === 'GET' && url.startsWith('/api/mastermind/session/')) {
      try {
        const sid = url.slice('/api/mastermind/session/'.length);
        // Check individual session file first
        const sessFile = path.join(projectDir || process.cwd(), 'data', 'sessions', `${sid}.json`);
        if (fs.existsSync(sessFile)) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(fs.readFileSync(sessFile, 'utf8'));
          return;
        }
        const f = path.join(projectDir || process.cwd(), 'data', 'mastermind-sessions.json');
        const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
        const s = sessions.find(x => x.id === sid);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(s || null));
      } catch (_) { res.writeHead(200); res.end('null'); }
      return;
    }

    // -------------------------------------------------------- GET /mastermind
    if (req.method === 'GET' && url === '/mastermind') {
      // Serve local file if present (dev), otherwise fall back to bundled HTML
      const root = projectDir || process.cwd();
      const htmlPath = path.join(root, 'docs', 'mastermind-diagram.html');
      let html = MASTERMIND_DIAGRAM_HTML;
      try { html = fs.readFileSync(htmlPath, 'utf8'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ----------------------------------------------------------- GET /orgs
    if (req.method === 'GET' && url === '/orgs') {
      try {
        const htmlPath = path.join(__dirname, 'orgs.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(404);
        res.end(`orgs.html not found: ${err.message}`);
      }
      return;
    }

    // GET /api/mastermind/loops — list all active loop state files
    if (req.method === 'GET' && url === '/api/mastermind/loops') {
      try {
        const loopsDir = path.join(projectDir || process.cwd(), '.monomind', 'loops');
        const loops = [];
        if (fs.existsSync(loopsDir)) {
          const files = fs.readdirSync(loopsDir).filter(f => f.endsWith('.json') && !f.includes('-hil'));
          for (const f of files) {
            try {
              const d = JSON.parse(fs.readFileSync(path.join(loopsDir, f), 'utf8'));
              loops.push(d);
            } catch(_) {}
          }
        }
        loops.sort((a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ loops }));
      } catch(_) { res.writeHead(500); res.end('{"loops":[]}'); }
      return;
    }

    // GET /api/status — live system snapshot for dashboard polling
    if (req.method === 'GET' && url === '/api/status') {
      try {
        const root = projectDir || process.cwd();
        // Active org runs: { orgName -> runId }
        const orgRuns = {};
        activeOrgRuns.forEach((runId, org) => { orgRuns[org] = runId; });
        // Recent events (last 10)
        let recentEvents = [];
        try {
          const evPath = path.join(root, 'data', 'mastermind-events.jsonl');
          const lines = fs.readFileSync(evPath, 'utf8').split('\n').filter(l => l.trim()).slice(-10);
          recentEvents = lines.map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
        } catch(_) {}
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          ts: Date.now(),
          uptime: process.uptime(),
          dir: root,
          sseClients: getMmClientCount(),
          activeOrgs: Object.keys(orgRuns).length,
          orgRuns,
          recentEvents,
        }));
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/orgs/:name/runs/current — events from the active run file for an org
    if (req.method === 'GET' && /^\/api\/orgs\/[^/]+\/runs\/current$/.test(url)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        const _curQs = new URL(req.url, 'http://localhost').searchParams;
        const root = path.resolve(_curQs.get('dir') || projectDir || process.cwd());
        // Validate orgName
        if (!orgName || orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
          res.writeHead(400); res.end('{"error":"invalid org name"}'); return;
        }
        const runId = activeOrgRuns.get(orgName);
        const monoDir = _getGitMonomindDir(root) || path.join(root, '.monomind');
        // Try active run first, then fall back to most recent run file
        let runFile = null;
        if (runId) {
          const candidate = path.join(monoDir, 'orgs', orgName, 'runs', `${runId}.jsonl`);
          if (fs.existsSync(candidate)) runFile = candidate;
        }
        if (!runFile) {
          const runsDir = path.join(monoDir, 'orgs', orgName, 'runs');
          if (fs.existsSync(runsDir)) {
            const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.jsonl'));
            if (files.length) {
              files.sort();
              runFile = path.join(runsDir, files[files.length - 1]);
            }
          }
        }
        if (!runFile) { res.writeHead(404); res.end('{"events":[],"runId":null}'); return; }
        const detectedRunId = path.basename(runFile, '.jsonl');
        const lines = fs.readFileSync(runFile, 'utf8').split('\n').filter(l => l.trim()).slice(-100);
        const events = lines.map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ runId: detectedRunId, events, active: activeOrgRuns.has(orgName) }));
      } catch(err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/mastermind/metrics — aggregate system metrics from token-summary and swarm-activity
    if (req.method === 'GET' && url === '/api/mastermind/metrics') {
      try {
        const base = path.join(projectDir || process.cwd(), '.monomind', 'metrics');
        let tokens = {}, swarm = {}, events = [];
        try { tokens = JSON.parse(fs.readFileSync(path.join(base, 'token-summary.json'), 'utf8')); } catch(_) {}
        try { swarm  = JSON.parse(fs.readFileSync(path.join(base, 'swarm-activity.json'), 'utf8')); } catch(_) {}
        try {
          const evPath = path.join(projectDir || process.cwd(), 'data', 'mastermind-events.jsonl');
          const lines = fs.readFileSync(evPath, 'utf8').split('\n').filter(l => l.trim()).slice(-20);
          events = lines.map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
        } catch(_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tokens, swarm, recentEvents: events }));
      } catch(_) { res.writeHead(500); res.end('{"tokens":{},"swarm":{},"recentEvents":[]}'); }
      return;
    }

    // ----------------------------------------------- GET /api/monoagent/platforms
    // Returns all supported platforms from `monoes connect list --all --json`
    if (req.method === 'GET' && url === '/api/monoagent/platforms') {
      try {
        const { execFile } = await import('child_process');
        const out = await new Promise((resolve, reject) => {
          execFile('monoes', ['connect', 'list', '--all', '--json'], { timeout: 8000 }, (err, stdout) => {
            if (err) reject(err); else resolve(stdout);
          });
        });
        // Parse + re-serialize to ensure only valid JSON reaches the client
        // (monoes may emit warning lines before the JSON array)
        let parsed; try { parsed = JSON.parse(out); } catch (_) { parsed = []; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(parsed) ? parsed : []));
      } catch (e) { res.writeHead(200); res.end('[]'); }
      return;
    }

    // ----------------------------------------------- GET /api/monoagent/connections
    // Returns active API/OAuth connections + browser sessions merged
    if (req.method === 'GET' && url === '/api/monoagent/connections') {
      try {
        const { execFile } = await import('child_process');
        const [connsOut, sessOut] = await Promise.all([
          new Promise((resolve) => {
            execFile('monoes', ['connect', 'list', '--json'], { timeout: 8000 }, (err, stdout) => resolve(err ? '[]' : stdout));
          }),
          new Promise((resolve) => {
            execFile('monoes', ['--json', 'login', 'status'], { timeout: 8000 }, (err, stdout) => resolve(err ? '[]' : stdout));
          }),
        ]);
        let connections = []; try { connections = JSON.parse(connsOut); } catch (_) {}
        let sessions = []; try { sessions = JSON.parse(sessOut); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connections, sessions }));
      } catch (e) { res.writeHead(200); res.end(JSON.stringify({ connections: [], sessions: [] })); }
      return;
    }

    // ----------------------------------------------- POST /api/monoagent/login
    // Launches browser login for social platforms via `monoes login <platform>`
    if (req.method === 'POST' && url === '/api/monoagent/login') {
      try {
        let body = '';
        await new Promise((resolve, reject) => { req.on('data', d => { body += d; if (body.length > 65536) { req.destroy(); reject(new Error('body too large')); } }); req.on('end', resolve); req.on('error', reject); });
        const { id } = JSON.parse(body);
        if (!id || !/^[a-z][a-z0-9_-]*$/.test(id)) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid id' })); return; }
        const { spawn } = await import('child_process');
        const child = spawn('monoes', ['login', id, '--timeout', '10m'], { detached: true, stdio: 'ignore' });
        // Defer response until spawn confirms or errors — prevents race where error fires after res.end()
        child.once('spawn', () => {
          child.unref();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        child.once('error', (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // ----------------------------------------------- POST /api/monoagent/connect
    if (req.method === 'POST' && url === '/api/monoagent/connect') {
      try {
        let body = '';
        await new Promise((resolve, reject) => { req.on('data', d => { body += d; if (body.length > 65536) { req.destroy(); reject(new Error('body too large')); } }); req.on('end', resolve); req.on('error', reject); });
        const { id, method, fields } = JSON.parse(body);
        if (!id || !/^[a-z][a-z0-9_-]*$/.test(id)) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid id' })); return; }
        if (method && !/^[a-z][a-z0-9_-]*$/.test(method)) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid method' })); return; }
        const { execFile } = await import('child_process');
        const args = ['connect', id];
        if (method) args.push('--method', method);
        if (fields && typeof fields === 'object') {
          for (const [k, v] of Object.entries(fields)) {
            // Only allow simple word keys — prevents --flag injection
            if (!/^[a-z][a-z0-9_]*$/.test(k)) continue;
            args.push(`--${k}`, String(v).slice(0, 2048));
          }
        }
        await new Promise((resolve, reject) => {
          execFile('monoes', args, { timeout: 30000 }, (err, stdout, stderr) => {
            const ok = !err;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() }));
            resolve();
          });
        });
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // ----------------------------------------------- POST /api/monoagent/test
    if (req.method === 'POST' && url === '/api/monoagent/test') {
      try {
        let body = '';
        await new Promise((resolve, reject) => { req.on('data', d => { body += d; if (body.length > 65536) { req.destroy(); reject(new Error('body too large')); } }); req.on('end', resolve); req.on('error', reject); });
        const { id } = JSON.parse(body);
        if (!id || !/^[a-z0-9][a-z0-9_:-]*$/.test(id)) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
        const { execFile } = await import('child_process');
        await new Promise((resolve, reject) => {
          execFile('monoes', ['connect', 'test', id], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
          });
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }

    // ----------------------------------------------- POST /api/monoagent/disconnect
    if (req.method === 'POST' && url === '/api/monoagent/disconnect') {
      try {
        let body = '';
        await new Promise((resolve, reject) => { req.on('data', d => { body += d; if (body.length > 65536) { req.destroy(); reject(new Error('body too large')); } }); req.on('end', resolve); req.on('error', reject); });
        const { id, type } = JSON.parse(body);
        if (!id || !/^[a-z0-9][a-z0-9_:-]*$/.test(id)) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
        if (type !== 'session' && type !== 'connection') { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid type' })); return; }
        const { execFile } = await import('child_process');
        const cmd = type === 'session' ? ['logout', id] : ['connect', 'remove', id];
        await new Promise((resolve, reject) => {
          execFile('monoes', cmd, { timeout: 10000 }, (err, _stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message)); else resolve();
          });
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }

    // ------------------------------------------------- POST /api/playbooks
    // Save a playbook definition to .monomind/playbooks/<id>.json
    if (req.method === 'POST' && url === '/api/playbooks') {
      try {
        let body = '';
        await new Promise((resolve, reject) => {
          req.on('data', d => { body += d; });
          req.on('end', resolve);
          req.on('error', reject);
        });
        const pb = JSON.parse(body);
        if (!pb.id || !pb.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id and name are required' }));
          return;
        }
        const dir = projectDir || process.cwd();
        const playbookDir = path.join(dir, '.monomind', 'playbooks');
        fs.mkdirSync(playbookDir, { recursive: true });
        const filePath = path.join(playbookDir, pb.id + '.json');
        fs.writeFileSync(filePath, JSON.stringify(pb, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: pb.id, file: pb.id + '.json' }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // ------------------------------------------------- GET /api/workflow-defs
    if (req.method === 'GET' && url === '/api/workflow-defs') {
      try {
        const qp = new URL(req.url, 'http://x').searchParams;
        const dir = qp.get('dir') || projectDir || process.cwd();
        const playbookDir = path.join(dir, '.monomind', 'playbooks');
        const result = [];
        if (fs.existsSync(playbookDir)) {
          const files = fs.readdirSync(playbookDir).filter(f => f.endsWith('.json'));
          for (const file of files) {
            try {
              const fpath = path.join(playbookDir, file);
              const stat = fs.statSync(fpath);
              const def = JSON.parse(fs.readFileSync(fpath, 'utf8'));
              const params = (def.params || []).map(p => typeof p === 'string' ? p : (p.name || p.key || ''));
              result.push({
                id: def.id || file.replace('.json', ''),
                name: def.name || file.replace('.json', ''),
                description: def.description || null,
                file,
                nodeCount: Array.isArray(def.nodes) ? def.nodes.length : 0,
                params,
                modifiedAt: stat.mtimeMs,
              });
            } catch (_) {}
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // ------------------------------------------------- GET /api/workflow-runs
    if (req.method === 'GET' && url === '/api/workflow-runs') {
      // Reads from ~/.monomind/browse-runs.json written by the monobrowse dashboard server.
      try {
        const runsFile = path.join(os.homedir(), '.monomind', 'browse-runs.json');
        if (fs.existsSync(runsFile)) {
          const raw = fs.readFileSync(runsFile, 'utf-8');
          const runs = JSON.parse(raw);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(Array.isArray(runs) ? runs : []));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    // ---- POST /api/orgs/:name/mark-complete — manual STALE recovery ----
    if (req.method === 'POST' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/mark-complete$/i.test(url)) {
      const _mcOrgName = decodeURIComponent(url.split('/')[3]);
      if (_mcOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_mcOrgName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid org name' })); return;
      }
      const _mcRoot = projectDir || process.cwd();
      const _mcMonoDir = _getGitMonomindDir(_mcRoot) || path.join(_mcRoot, '.monomind');
      const _mcRunId = activeOrgRuns.get(_mcOrgName) || _getActiveRunId(_mcOrgName, _mcRoot);
      if (!_mcRunId) {
        res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No active run for org: ' + _mcOrgName })); return;
      }
      const _mcEvent = { type: 'run:complete', org: _mcOrgName, runId: _mcRunId, ts: Date.now(), reason: 'manual' };
      try {
        const _mcRunFile = path.join(_mcMonoDir, 'orgs', _mcOrgName, 'runs', `${_mcRunId}.jsonl`);
        if (fs.existsSync(_mcRunFile)) await appendToFile(_mcRunFile, JSON.stringify(_mcEvent) + '\n');
        activeOrgRuns.delete(_mcOrgName);
        // Clean up ppid-keyed active-run files for this org
        const _mcCapDir = path.join(MONOMIND_HOME, '.monomind', 'capture');
        try {
          const _mcPpidDir = path.join(_mcCapDir, 'active-runs');
          if (fs.existsSync(_mcPpidDir)) {
            fs.readdirSync(_mcPpidDir).filter(f => f.endsWith('.json')).forEach(_pf => {
              try { const _pd = JSON.parse(fs.readFileSync(path.join(_mcPpidDir, _pf), 'utf8')); if (_pd.org === _mcOrgName) fs.unlinkSync(path.join(_mcPpidDir, _pf)); } catch (_) {}
            });
          }
          const _mcActiveFile = path.join(_mcCapDir, 'active-run.json');
          if (fs.existsSync(_mcActiveFile)) {
            try { const _a = JSON.parse(fs.readFileSync(_mcActiveFile, 'utf8')); if (_a.org === _mcOrgName) fs.unlinkSync(_mcActiveFile); } catch (_) {}
          }
        } catch (_) {}
        _updateRunState(_mcEvent, _mcRoot);
        broadcastMm(_mcEvent);
        const _mcFwdClients = runStreamClients.get(_mcOrgName);
        if (_mcFwdClients && _mcFwdClients.size > 0) {
          const _mcLine = `data: ${JSON.stringify(_mcEvent)}\n\n`;
          for (const _cl of _mcFwdClients) { try { _cl.write(_mcLine); } catch (_) { _mcFwdClients.delete(_cl); } }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, runId: _mcRunId }));
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      return;
    }

    // ---- GET /api/orgs/:name/runs/current/stream — Phase 3 streaming tail ----
    if (req.method === 'GET' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/runs\/current\/stream$/i.test(url)) {
      const _stOrgName = decodeURIComponent(url.split('/')[3]);
      if (_stOrgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(_stOrgName)) {
        res.writeHead(400); res.end('Invalid org name'); return;
      }
      const _stQs = new URL(req.url, 'http://localhost').searchParams;
      const _stSince = Math.max(0, parseInt(_stQs.get('since') || '0', 10) || 0);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      // Register client for live events
      if (!runStreamClients.has(_stOrgName)) runStreamClients.set(_stOrgName, new Set());
      runStreamClients.get(_stOrgName).add(res);
      // Replay events since `since` (SQLite row id cursor; falls back to JSONL line offset)
      try {
        if (_runDb) {
          // SQLite path: cursor is last row id seen (client sends 0 on first connect)
          const _stStmt = _runDb.prepare(
            'SELECT id, raw FROM run_events WHERE org=? AND id > ? ORDER BY id LIMIT 2000'
          );
          _stStmt.bind([_stOrgName, _stSince]);
          let _stLastId = _stSince;
          while (_stStmt.step()) {
            const _stRow = _stStmt.getAsObject();
            try { res.write(`data: ${_stRow.raw}\n\n`); _stLastId = _stRow.id; } catch (_) { break; }
          }
          _stStmt.free();
          res.write(`data: ${JSON.stringify({ type: 'stream:replay-done', count: _stLastId })}\n\n`);
        } else {
          // JSONL fallback: since = 0-based line offset
          const _stRoot = projectDir || process.cwd();
          const _stRunId = activeOrgRuns.get(_stOrgName) || _getActiveRunId(_stOrgName, _stRoot);
          if (_stRunId) {
            const _stMono = _getGitMonomindDir(_stRoot) || path.join(_stRoot, '.monomind');
            const _stRunFile = path.join(_stMono, 'orgs', _stOrgName, 'runs', `${_stRunId}.jsonl`);
            if (fs.existsSync(_stRunFile)) {
              const _stLines = fs.readFileSync(_stRunFile, 'utf8').trim().split('\n').filter(Boolean);
              for (let _i = _stSince; _i < _stLines.length; _i++) {
                try { res.write(`data: ${_stLines[_i]}\n\n`); } catch (_) { break; }
              }
              res.write(`data: ${JSON.stringify({ type: 'stream:replay-done', count: _stLines.length })}\n\n`);
            }
          }
        }
      } catch (_) {}
      const _stKa = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { clearInterval(_stKa); } }, 20000);
      req.on('close', () => {
        clearInterval(_stKa);
        const _stClients = runStreamClients.get(_stOrgName);
        if (_stClients) { _stClients.delete(res); if (_stClients.size === 0) runStreamClients.delete(_stOrgName); }
      });
      return;
    }

    // ------------------------------------------------------------------ 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  // ── Gap-fill ordering (ADR Issue 7): rebuild activeOrgRuns BEFORE the server
  // starts accepting connections so the first incoming event already has runId context.
  // Uses SQLite when available; falls back to JSONL scan.
  await _initRunDb(MONOMIND_HOME);
  try {
    if (_runDb) {
      // SQLite gap-fill: for each org, find latest run_id and check if it has run:complete
      const _gfOrgsStmt = _runDb.prepare('SELECT DISTINCT org FROM run_events');
      while (_gfOrgsStmt.step()) {
        const _gfOrg = _gfOrgsStmt.getAsObject().org;
        if (!_gfOrg || !/^[a-z0-9][a-z0-9_-]*$/i.test(_gfOrg)) continue;
        // Resolve the latest run_id for this org, then check if it has a terminal event
        const _gfLatRunStmt = _runDb.prepare(
          "SELECT run_id FROM run_events WHERE org=? ORDER BY id DESC LIMIT 1"
        );
        _gfLatRunStmt.bind([_gfOrg]);
        let _gfLatestRun = null;
        if (_gfLatRunStmt.step()) _gfLatestRun = _gfLatRunStmt.getAsObject().run_id;
        _gfLatRunStmt.free();
        let _gfDone = false;
        if (_gfLatestRun) {
          const _gfRunStmt = _runDb.prepare(
            "SELECT type FROM run_events WHERE org=? AND run_id=? AND type IN ('run:complete','org:complete','org:stop') LIMIT 1"
          );
          _gfRunStmt.bind([_gfOrg, _gfLatestRun]);
          if (_gfRunStmt.step()) _gfDone = true;
          _gfRunStmt.free();
        }
        if (_gfLatestRun && !_gfDone) activeOrgRuns.set(_gfOrg, _gfLatestRun);
      }
      _gfOrgsStmt.free();
    } else {
      // JSONL fallback
      const _gfOrgsDir = path.join(MONOMIND_HOME, '.monomind', 'orgs');
      if (fs.existsSync(_gfOrgsDir)) {
        for (const _gfOrg of fs.readdirSync(_gfOrgsDir)) {
          if (!_gfOrg || _gfOrg.startsWith('.') || !/^[a-z0-9][a-z0-9_-]*$/i.test(_gfOrg)) continue;
          const _gfRunsDir = path.join(_gfOrgsDir, _gfOrg, 'runs');
          if (!fs.existsSync(_gfRunsDir)) continue;
          const _gfFiles = fs.readdirSync(_gfRunsDir)
            .filter(f => f.endsWith('.jsonl') && !f.endsWith('.convs.jsonl'))
            .sort().reverse();
          for (const _gfF of _gfFiles.slice(0, 5)) {
            try {
              const _gfId = _gfF.replace('.jsonl', '');
              const _gfContent = fs.readFileSync(path.join(_gfRunsDir, _gfF), 'utf8');
              const _gfLast = _gfContent.trim().split('\n').filter(Boolean).slice(-10);
              const _gfDone = _gfLast.some(l => { try { const e = JSON.parse(l); return e.type === 'run:complete' || e.type === 'org:complete'; } catch { return false; } });
              if (!_gfDone) { activeOrgRuns.set(_gfOrg, _gfId); break; }
            } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}

  // Bind to available port (after activeOrgRuns is populated — no race window)
  const boundPort = await bindServer(server, port);
  const url = `http://localhost:${boundPort}`;

  // ── One-time migration: mastermind-sessions.json → per-session JSONL ─────
  // Runs once on startup. Existing sessions in the old monolithic format are
  // split into individual JSONL files + _index.json for O(1) event writes.
  try {
    const _migDataDir = path.join(projectDir || process.cwd(), 'data');
    const _migOldFile = path.join(_migDataDir, 'mastermind-sessions.json');
    const _migSessDir = path.join(_migDataDir, 'sessions');
    const _migIndexFile = path.join(_migSessDir, '_index.json');
    if (fs.existsSync(_migOldFile) && !fs.existsSync(_migIndexFile)) {
      try {
        const _migOld = JSON.parse(fs.readFileSync(_migOldFile, 'utf8'));
        fs.mkdirSync(_migSessDir, { recursive: true });
        const _migIndex = [];
        for (const sess of (_migOld || [])) {
          const _msid = String(sess.id || '').trim();
          if (!_msid || !/^(?!.*\.\.)[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(_msid)) continue;
          // Write per-session JSONL
          const _mEvts = (sess.events || []);
          const _mLines = _mEvts.map(e => JSON.stringify(e)).join('\n');
          fs.writeFileSync(path.join(_migSessDir, `${_msid}.jsonl`), _mLines + (_mLines ? '\n' : ''));
          _migIndex.push({ id: _msid, ts: sess.ts, prompt: sess.prompt || '',
            status: sess.status || 'complete', org: sess.org || '',
            startedAt: sess.ts || sess.startedAt, endedAt: sess.endTs || sess.endedAt,
            domains: sess.domains || [] });
        }
        fs.writeFileSync(_migIndexFile, JSON.stringify(_migIndex));
        console.log('[server] migrated ' + _migIndex.length + ' sessions to per-session JSONL format');
      } catch(_me) { console.warn('[server] session migration failed:', _me.message); }
    }
  } catch (_) {}

  // ---------------------------------------------------------------- Watchers
  let debounceTimer = null;
  let pendingSections = new Set();

  function scheduleRefresh(event, filename) {
    const sections = pathToSections(filename);
    if (sections) sections.forEach(s => pendingSections.add(s));
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changed = pendingSections.size > 0
        ? Array.from(pendingSections)
        : ['sessions', 'swarm', 'agents', 'tokens', 'hooks', 'memory', 'knowledge', 'metrics'];
      pendingSections.clear();
      broadcast({ kind: 'changed', sections: changed });
    }, 500);
  }

  // Watch .monomind directory
  const monomindDir = path.join(projectDir || process.cwd(), '.monomind');
  if (fs.existsSync(monomindDir)) {
    try {
      const w = fs.watch(monomindDir, { recursive: true }, scheduleRefresh);
      activeWatchers.push(w);
    } catch {
      // Directory may not support recursive watch on all platforms — ignore
    }
  }

  // ── Phase 1: fs.watch orgs dir — pick up run events written directly to JSONL files
  // without going through the HTTP endpoint (e.g. when runorg.md bash writes run:start directly).
  // Also forwards new bytes to per-org SSE clients (runStreamClients) so the chat tab
  // receives bash-written lifecycle events in real-time (Phase 3 gap-fill).
  const _orgsFileSizes = new Map(); // absPath → last known byte offset
  function _readNewOrgLines(absPath, orgName, runId) {
    try {
      const stat = fs.statSync(absPath);
      const prevSize = _orgsFileSizes.get(absPath) || 0;
      if (stat.size <= prevSize) return; // nothing new
      _orgsFileSizes.set(absPath, stat.size);
      // Read only the new bytes to avoid re-processing existing lines
      const fd = fs.openSync(absPath, 'r');
      const newLen = stat.size - prevSize;
      const buf = Buffer.alloc(newLen);
      fs.readSync(fd, buf, 0, newLen, prevSize);
      fs.closeSync(fd);
      const newText = buf.toString('utf8');
      const newLines = newText.split('\n').filter(Boolean);
      const clients = runStreamClients.get(orgName);
      for (const _rawLine of newLines) {
        let ev;
        try { ev = JSON.parse(_rawLine); } catch { continue; }
        if (!ev || !ev.type) continue;
        // Index in SQLite (watcher path — bash-written lifecycle events)
        if (!ev.org) ev.org = orgName;
        if (!ev.runId) ev.runId = runId;
        _insertRunEvent(ev, 'watcher');
        // Update activeOrgRuns based on file-watcher evidence
        if ((ev.type === 'run:start' || ev.type === 'org:start') && ev.runId) {
          activeOrgRuns.set(orgName, String(ev.runId).trim());
        } else if (ev.type === 'run:complete' || ev.type === 'org:complete' || ev.type === 'org:stop') {
          activeOrgRuns.delete(orgName);
        }
        // Forward to per-org SSE clients so the chat tab gets live bash-written events
        if (clients && clients.size > 0) {
          const _sseData = `data: ${_rawLine}\n\n`;
          for (const _cl of clients) { try { _cl.write(_sseData); } catch (_) { clients.delete(_cl); } }
        }
        // Also broadcast to mastermind-stream for the org activity strip
        if (ev.org && ev.org === orgName) broadcastMm({ ...ev, _fromWatcher: true });
      }
    } catch (_) {}
  }

  function watchOrgsDir() {
    const _orgsDir = path.join(MONOMIND_HOME, '.monomind', 'orgs');
    if (!fs.existsSync(_orgsDir)) {
      // Orgs dir may not exist yet; watch parent and re-try when it appears
      const _parentDir = path.join(MONOMIND_HOME, '.monomind');
      if (fs.existsSync(_parentDir)) {
        try {
          fs.watch(_parentDir, (_evType, _fname) => {
            if (_fname === 'orgs' && fs.existsSync(_orgsDir)) watchOrgsDir();
          });
        } catch (_) {}
      }
      return;
    }
    // Seed initial file sizes so the watcher only forwards NEW bytes after startup
    try {
      for (const _org of fs.readdirSync(_orgsDir)) {
        const _runsDir = path.join(_orgsDir, _org, 'runs');
        if (!fs.existsSync(_runsDir)) continue;
        for (const _f of fs.readdirSync(_runsDir).filter(f => f.endsWith('.jsonl') && !f.endsWith('.warm.jsonl') && !f.endsWith('.convs.jsonl'))) {
          try { _orgsFileSizes.set(path.join(_runsDir, _f), fs.statSync(path.join(_runsDir, _f)).size); } catch (_) {}
        }
      }
    } catch (_) {}
    // Use chokidar when available (Linux requires it — fs.watch { recursive } is macOS/Windows only).
    // Falls back to fs.watch for environments where chokidar is absent.
    let _watcherStarted = false;
    try {
      const chokidar = _require('chokidar');
      const _chokidarWatcher = chokidar.watch(_orgsDir, {
        persistent: false,
        ignoreInitial: true,
        depth: 3,
        ignored: (p) => {
          const b = path.basename(p);
          return b.endsWith('.warm.jsonl') || b.endsWith('.convs.jsonl') || b.startsWith('.');
        },
        awaitWriteFinish: false,
      });
      const _handleChokidarPath = (absPath) => {
        if (!absPath.endsWith('.jsonl')) return;
        const rel = path.relative(_orgsDir, absPath).replace(/\\/g, '/');
        const parts = rel.split('/');
        if (parts.length >= 3 && parts[1] === 'runs') {
          const _wOrgName = parts[0];
          const _wRunId = parts[2].replace('.jsonl', '');
          if (_wOrgName && _wRunId && /^[a-z0-9][a-z0-9_-]*$/i.test(_wOrgName) && /^[a-z0-9][a-z0-9_-]*$/i.test(_wRunId)) {
            _readNewOrgLines(absPath, _wOrgName, _wRunId);
          }
        }
      };
      _chokidarWatcher.on('add', _handleChokidarPath);
      _chokidarWatcher.on('change', _handleChokidarPath);
      activeWatchers.push({ close: () => _chokidarWatcher.close() });
      _watcherStarted = true;
    } catch (_chokidarErr) { /* chokidar unavailable — fall through to fs.watch */ }
    if (!_watcherStarted) {
      try {
        const _orgsWatcher = fs.watch(_orgsDir, { recursive: true, persistent: false }, (_evType, _fname) => {
          if (!_fname || !_fname.endsWith('.jsonl') || _fname.endsWith('.warm.jsonl') || _fname.endsWith('.convs.jsonl')) return;
          const _parts = _fname.replace(/\\/g, '/').split('/');
          if (_parts.length >= 3 && _parts[1] === 'runs') {
            const _wOrgName = _parts[0];
            const _wRunId = _parts[2].replace('.jsonl', '');
            if (_wOrgName && _wRunId && /^[a-z0-9][a-z0-9_-]*$/i.test(_wOrgName) && /^[a-z0-9][a-z0-9_-]*$/i.test(_wRunId)) {
              _readNewOrgLines(path.join(_orgsDir, _fname.replace(/\\/g, '/')), _wOrgName, _wRunId);
            }
          }
        });
        activeWatchers.push(_orgsWatcher);
      } catch (_wErr) {
        console.warn('[monomind] watchOrgsDir: both chokidar and fs.watch failed — bash-written lifecycle events will not reach SSE clients. HTTP-posted events still work via spool DLQ.');
      }
    }
  }
  watchOrgsDir();

  // Watch .claude/sessions/ if present
  const claudeSessionsDir = path.join(projectDir || process.cwd(), '.claude', 'sessions');
  if (fs.existsSync(claudeSessionsDir)) {
    try {
      const w = fs.watch(claudeSessionsDir, { recursive: true }, scheduleRefresh);
      activeWatchers.push(w);
    } catch {
      // Ignore unsupported watch
    }
  }

  // ── Phase 2: Spool polling — replay undelivered events from capture-handler (Issue 5) ──
  // capture-handler writes events to spool/ before HTTP POST. If the POST fails (server
  // down, timeout), the file stays. We poll every 5s and replay them.
  const _spoolBaseDir = path.join(MONOMIND_HOME, '.monomind', 'capture', 'spool');
  const _spoolTimer = setInterval(() => {
    if (!fs.existsSync(_spoolBaseDir)) return;
    try {
      const _spoolFiles = fs.readdirSync(_spoolBaseDir)
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .sort() // chronological (timestamp prefix)
        .slice(0, 20); // max 20 per cycle to avoid flooding
      for (const _sf of _spoolFiles) {
        const _sfPath = path.join(_spoolBaseDir, _sf);
        try {
          const _spoolEvent = JSON.parse(fs.readFileSync(_sfPath, 'utf8'));
          const _spoolBody = JSON.stringify(_spoolEvent);
          const _spoolReq = http.request({
            hostname: 'localhost', port: boundPort,
            path: '/api/mastermind/event', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(_spoolBody) },
          }, (_spoolRes) => {
            // Delete only after confirmed delivery; leave file on failure for next poll cycle
            if (_spoolRes.statusCode >= 200 && _spoolRes.statusCode < 300) {
              try { fs.unlinkSync(_sfPath); } catch (_) {}
            }
            _spoolRes.resume();
          });
          _spoolReq.on('error', () => {});
          _spoolReq.setTimeout(2000, () => { _spoolReq.destroy(); });
          _spoolReq.write(_spoolBody);
          _spoolReq.end();
        } catch (_e) {}
      }
    } catch (_) {}
  }, 5000);
  // Clean up spool files older than 8 hours on startup (stale captures from crashed sessions)
  try {
    if (fs.existsSync(_spoolBaseDir)) {
      const _staleMs = 8 * 60 * 60 * 1000;
      fs.readdirSync(_spoolBaseDir).filter(f => f.endsWith('.json')).forEach(_staleF => {
        const _staleP = path.join(_spoolBaseDir, _staleF);
        try {
          if (Date.now() - fs.statSync(_staleP).mtimeMs > _staleMs) fs.unlinkSync(_staleP);
        } catch (_) {}
      });
    }
  } catch (_) {}

  // ── Phase 3: Read-batch polling — aggregate file-read events from capture-handler (Issue 9) ──
  // capture-handler writes Read tool calls to capture/read-batch-{ppid}-{pid}.json (per-subagent, no sharing).
  // Server polls every 3s, aggregates all matching files per session, emits agent:read:batch, removes files.
  const _rbDir = path.join(MONOMIND_HOME, '.monomind', 'capture');
  const _rbTimer = setInterval(() => {
    if (!fs.existsSync(_rbDir)) return;
    try {
      fs.readdirSync(_rbDir)
        .filter(f => f.startsWith('read-batch-') && f.endsWith('.json'))
        .forEach(_rbf => {
          const _rbPath = path.join(_rbDir, _rbf);
          try {
            const _rbData = JSON.parse(fs.readFileSync(_rbPath, 'utf8'));
            fs.unlinkSync(_rbPath);
            if (!Array.isArray(_rbData) || _rbData.length === 0) return;
            const _rbOrg = String(_rbData[0].org || '').trim();
            const _rbRunId = String(_rbData[0].runId || '').trim();
            const _rbEvent = {
              type: 'agent:read:batch',
              org: _rbOrg,
              runId: _rbRunId,
              paths: _rbData.map(e => String(e.path || '').slice(0, 256)),
              count: _rbData.length,
              ts: Date.now(),
            };
            const _rbBody = JSON.stringify(_rbEvent);
            const _rbReq = http.request({
              hostname: 'localhost', port: boundPort,
              path: '/api/mastermind/event', method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(_rbBody) },
            }, () => {});
            _rbReq.on('error', () => {});
            _rbReq.setTimeout(2000, () => { _rbReq.destroy(); });
            _rbReq.write(_rbBody);
            _rbReq.end();
          } catch (_e) {}
        });
    } catch (_) {}
  }, 3000);

  // ── Phase 4: Daemon heartbeat — ps -p {ppid} liveness check (Issue 8) ──
  // Periodically checks if the Claude Code session (tracked via ppid-keyed files) is still alive.
  // If the parent process is gone, auto-emits org:stop to close stale LIVE orgs in the dashboard.
  const _ppidCheckDir = path.join(MONOMIND_HOME, '.monomind', 'capture', 'active-runs');
  const _heartbeatTimer = setInterval(() => {
    if (!fs.existsSync(_ppidCheckDir)) return;
    try {
      fs.readdirSync(_ppidCheckDir).filter(f => f.endsWith('.json')).forEach(_ppf => {
        const _ppPath = path.join(_ppidCheckDir, _ppf);
        try {
          const _ppData = JSON.parse(fs.readFileSync(_ppPath, 'utf8'));
          const _ppid = parseInt(_ppf.replace('.json', ''), 10);
          if (!_ppid || isNaN(_ppid)) return;
          // Check if the ppid process is still alive (signal 0 = probe, no kill)
          try {
            process.kill(_ppid, 0);
            // Process alive — no action
          } catch (_psErr) {
            // Process gone — emit org:stop and remove the ppid file
            fs.unlinkSync(_ppPath);
            const _staleOrg = String(_ppData.org || '').trim();
            const _staleRun = String(_ppData.runId || '').trim();
            if (_staleOrg && activeOrgRuns.has(_staleOrg)) {
              const _stopBody = JSON.stringify({ type: 'org:stop', org: _staleOrg, runId: _staleRun, reason: 'ppid-dead', ts: Date.now() });
              const _stopReq = http.request({
                hostname: 'localhost', port: boundPort,
                path: '/api/mastermind/event', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(_stopBody) },
              }, () => {});
              _stopReq.on('error', () => {});
              _stopReq.setTimeout(2000, () => { _stopReq.destroy(); });
              _stopReq.write(_stopBody);
              _stopReq.end();
            }
          }
        } catch (_) {}
      });
    } catch (_) {}
  }, 60000); // every 60s — intentionally infrequent, just a safety net

  // Update module-level state
  running = true;
  currentPort = boundPort;
  currentUrl = url;
  activeServer = server;

  // --------------------------------------------------------- Graceful shutdown
  function shutdown() {
    clearInterval(_spoolTimer);
    clearInterval(_rbTimer);
    clearInterval(_heartbeatTimer);
    // Flush SQLite run-event index to disk before exit (bypasses 1000ms debounce timer)
    clearTimeout(_runDbPersistTimer);
    if (_runDb && _runDbPath) {
      try { fs.writeFileSync(_runDbPath, Buffer.from(_runDb.export())); } catch (_) {}
    }
    for (const w of activeWatchers) {
      try {
        w.close();
      } catch {
        // Already closed
      }
    }
    activeWatchers.length = 0;

    // Close all SSE connections
    closeSseClients();

    // Drain in-flight JSONL appends before closing (prevents truncated writes on fast SIGTERM)
    Promise.all([..._writeQueue.values()]).catch(() => {}).finally(() => {
      server.close(() => {
        running = false;
        currentPort = null;
        currentUrl = null;
        activeServer = null;
      });
    });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // ---------------------------------------------------------- Auto-open
  if (openBrowser) {
    openUrl(url).catch(() => {
      // Non-fatal: browser open failure should not crash the server
    });
  }

  return { port: boundPort, url, server };
}

/**
 * Returns the current server status.
 */
export function getServerStatus() {
  return {
    running,
    port: currentPort,
    url: currentUrl,
    clientCount: getSseClientCount(),
  };
}

// Auto-start when invoked directly: node server.mjs [port]
const _isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (_isMain) {
  const _port = parseInt(process.argv[2] || process.env.CONTROL_PORT || '4242', 10);
  const _dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  startServer({ port: _port, openBrowser: false, projectDir: _dir }).catch(err => {
    process.stderr.write(`[server] failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
