import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { collectAll, getWatchPaths, collectProject, collectSessions, collectSwarm, collectSwarmHistory, appendSwarmHistory, collectSwarmEvents, getSwarmDataSize, cleanSwarmData, collectAgents, collectTokens, collectHooks, collectKnowledge, collectMetrics, collectMemory, collectMemoryFiles, collectSystem } from './collector.mjs';

const JSONL_SIZE_CAP = 10 * 1024 * 1024; // 10 MB — skip files larger than this in /api/graph
const buildDocsState = new Map(); // key: resolved dir → { status, sections, files, error, startedAt, completedAt }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTERMIND_DIAGRAM_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>MASTERMIND — Live Dashboard</title>\n<style>\n* { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body {\n  width: 100%; height: 100%; overflow: hidden;\n  background: #07071a;\n  font-family: 'Azeret Mono', 'Space Mono', 'Courier New', monospace;\n  color: #e0e0ff;\n  user-select: none;\n}\n\n/* ── Main layout ── */\n#app { display: flex; height: 100vh; }\n#sidebar {\n  width: 220px; flex-shrink: 0;\n  background: oklch(9% 0.012 186);\n  border-right: 1px solid oklch(62% 0.2 186 / 0.18);\n  display: flex; flex-direction: column;\n  overflow: hidden; z-index: 10;\n}\n#stage-wrap { flex: 1; position: relative; overflow: hidden; }\n#detail-panel {\n  width: 0; flex-shrink: 0; overflow: hidden;\n  background: oklch(9% 0.012 186);\n  border-left: 1px solid oklch(62% 0.2 186 / 0.18);\n  transition: width 0.3s ease;\n  display: flex; flex-direction: column;\n  z-index: 10;\n}\n#detail-panel.open { width: 280px; }\n#stage { position: absolute; inset: 0; width: 100%; height: 100%; }\n\n/* ── Sidebar ── */\n#sb-header {\n  padding: 14px 14px 10px;\n  border-bottom: 1px solid oklch(62% 0.2 186 / 0.18);\n  flex-shrink: 0;\n}\n#sb-title {\n  font-size: 8px; letter-spacing: 4px; color: oklch(52% 0.1 186); margin-bottom: 4px;\n}\n.live-row { display: flex; align-items: center; gap: 6px; }\n.l-dot {\n  width: 6px; height: 6px; border-radius: 50%;\n  background: #252560; flex-shrink: 0;\n  transition: background 0.5s;\n}\n.l-dot.on { background: #28c068; }\n@media (prefers-reduced-motion: no-preference) { .l-dot.on { animation: ldp 2s ease-in-out infinite; } }\n@keyframes ldp { 0%,100%{opacity:1} 50%{opacity:0.4} }\n#l-status { font-size: 9px; letter-spacing: 2px; color: oklch(44% 0.08 186); }\n#l-agents { font-size: 8px; color: oklch(40% 0.07 186); margin-left: auto; }\n#sb-sessions {\n  flex: 1; overflow-y: auto; padding: 8px 0;\n  scrollbar-width: thin; scrollbar-color: oklch(62% 0.2 186 / 0.3) transparent;\n}\n#sb-sessions::-webkit-scrollbar { width: 4px; }\n#sb-sessions::-webkit-scrollbar-thumb { background: oklch(62% 0.2 186 / 0.3); border-radius: 2px; }\n.sess-item {\n  padding: 8px 14px; cursor: pointer;\n  border-left: 2px solid transparent;\n  transition: background 0.15s, border-color 0.15s;\n}\n.sess-item:hover { background: oklch(62% 0.2 186 / 0.09); }\n.sess-item.active { border-left-color: transparent; background: oklch(62% 0.2 186 / 0.14); box-shadow: inset 0 0 0 1px oklch(62% 0.2 186 / 0.32); }\n.sess-item.running { border-left-color: #28c068; }\n.sess-ts { font-size: 10px; color: oklch(42% 0.05 186); margin-bottom: 3px; }\n.sess-prompt {\n  font-size: 12px; color: oklch(70% 0.05 186); line-height: 1.4;\n  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 188px;\n}\n.sess-badges { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }\n.sess-project { font-size: 7px; color: oklch(40% 0.1 186); letter-spacing: 1px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.sess-badge {\n  font-size: 8px; padding: 2px 6px; border-radius: 3px;\n  border: 1px solid oklch(62% 0.2 186 / 0.25); color: oklch(62% 0.09 186);\n  background: oklch(62% 0.2 186 / 0.08);\n}\n.sess-badge.running-badge { border-color: rgba(40,192,104,0.4); color: #28c068; background: rgba(40,192,104,0.08); }\n#git-user-row {\n  display: flex; align-items: center; gap: 5px;\n  margin-top: 7px; padding-top: 6px;\n  border-top: 1px solid oklch(62% 0.2 186 / 0.12);\n}\n#git-user-icon { font-size: 9px; color: #3a3a70; }\n#git-user-name {\n  font-size: 9px; letter-spacing: 0.5px; color: #4a4a90;\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n}\n#git-cwd-row {\n  display: flex; align-items: center; gap: 5px; margin-top: 4px;\n}\n#git-cwd-icon { font-size: 9px; color: #2a2a58; }\n#git-cwd-name {\n  font-size: 9px; letter-spacing: 0.3px; color: #38386a;\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n  direction: rtl; text-align: left;\n}\n.sess-trace-link {\n  font-size: 7px; color: #3a3a70; text-decoration: none; letter-spacing: 0.5px;\n  padding: 1px 5px; border: 1px solid oklch(62% 0.2 186 / 0.2); border-radius: 3px;\n  margin-left: auto; flex-shrink: 0;\n}\n.sess-trace-link:hover { color: oklch(66% 0.11 186); border-color: oklch(62% 0.2 186 / 0.5); }\n.dp-export-btn {\n  font-size: 9px; font-family: inherit; color: oklch(58% 0.09 186); text-decoration: none;\n  padding: 4px 8px; border: 1px solid oklch(62% 0.2 186 / 0.25); border-radius: 4px;\n  background: oklch(62% 0.2 186 / 0.07); cursor: pointer; letter-spacing: 0.3px;\n}\n.dp-export-btn:hover { color: oklch(72% 0.12 186); border-color: oklch(62% 0.2 186 / 0.5); background: oklch(62% 0.2 186 / 0.15); }\n#sb-no-sessions {\n  padding: 20px 14px; font-size: 9px; color: oklch(42% 0.06 186); line-height: 1.7;\n  text-align: center;\n}\n#sb-movie-btn {\n  margin: 10px 14px;\n  background: oklch(62% 0.2 186 / 0.12);\n  border: 1px solid oklch(62% 0.2 186 / 0.35);\n  color: oklch(56% 0.16 186); font-size: 9px; letter-spacing: 2px;\n  border-radius: 6px; padding: 7px; cursor: pointer; width: calc(100% - 28px);\n  transition: background 0.15s, color 0.15s;\n  font-family: 'Azeret Mono', 'Space Mono', 'Courier New', monospace;\n}\n#sb-movie-btn:hover { background: oklch(62% 0.2 186 / 0.25); color: #d0b0ff; }\n#sb-movie-btn.active { background: oklch(62% 0.2 186 / 0.25); color: #d0b0ff; border-color: oklch(62% 0.2 186 / 0.6); }\n\n/* ── SVG title overlay ── */\n#title-wrap {\n  position: absolute; top: 16px; left: 50%; transform: translateX(-50%);\n  text-align: center; pointer-events: none; z-index: 5;\n}\n#title-h1 {\n  font-size: 22px; font-weight: 900; letter-spacing: 0.38em;\n  color: oklch(84% 0.14 186);\n}\n#title-sub { font-size: 9px; color: oklch(38% 0.06 186); letter-spacing: 3px; margin-top: 6px; }\n\n/* ── Prompt box ── */\n#prompt-box {\n  position: absolute; bottom: 76px; left: 50%; transform: translateX(-50%);\n  min-width: 340px; max-width: 500px;\n  background: rgba(6,4,22,0.96);\n  border: 1px solid rgba(130,80,255,0.5);\n  border-radius: 12px; padding: 10px 18px;\n  z-index: 50; opacity: 0;\n  box-shadow: 0 4px 28px rgba(100,50,255,0.16);\n  backdrop-filter: blur(18px);\n}\n#p-tag { font-size: 8px; letter-spacing: 3px; color: #48489a; margin-bottom: 4px; }\n#p-line { font-size: 12.5px; color: #90c8ff; display: flex; align-items: center; gap: 2px; min-height: 19px; }\n#p-cursor {\n  display: inline-block; width: 2px; height: 14px;\n  background: #90c8ff; flex-shrink: 0;\n  animation: blink 0.8s step-end infinite;\n}\n@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }\n\n/* ── Activity log ── */\n#activity-log {\n  position: absolute; left: 10px; bottom: 76px;\n  width: 240px;\n  background: rgba(5,3,18,0.93);\n  border: 1px solid rgba(70,45,165,0.35);\n  border-radius: 10px; padding: 9px 12px;\n  z-index: 50; opacity: 0;\n}\n#log-title { font-size: 7.5px; letter-spacing: 3px; color: #282870; margin-bottom: 6px;\n  padding-bottom: 5px; border-bottom: 1px solid rgba(70,45,165,0.18); }\n#log-entries { font-size: 9px; line-height: 1.95; max-height: 160px; overflow: hidden; }\n.log-row { display: flex; gap: 5px; opacity: 0; }\n.log-tag { font-weight: bold; min-width: 58px; flex-shrink: 0; }\n.log-msg { color: #525298; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }\n\n/* ── Mode banner ── */\n#mode-banner {\n  position: absolute; top: 14px; right: 10px;\n  font-size: 8px; letter-spacing: 3px; color: #303070;\n  z-index: 5; pointer-events: none;\n}\n#mode-banner.live-mode { color: #28c068; }\n\n/* ── Control bar ── */\n#ctrl {\n  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);\n  display: flex; align-items: center; gap: 7px;\n  background: rgba(8,6,26,0.95);\n  border: 1px solid rgba(100,60,220,0.35);\n  border-radius: 26px; padding: 6px 16px;\n  z-index: 100; backdrop-filter: blur(18px);\n  opacity: 0;\n}\n.c-btn {\n  background: none; border: 1px solid rgba(100,60,220,0.4);\n  color: #7858d0; width: 26px; height: 26px; border-radius: 50%;\n  cursor: pointer; font-size: 10px;\n  display: flex; align-items: center; justify-content: center;\n  transition: background 0.12s, color 0.12s; flex-shrink: 0; line-height: 1;\n}\n.c-btn:hover { background: rgba(100,60,220,0.2); color: #d0b0ff; }\n.c-btn.disabled { opacity: 0.3; pointer-events: none; }\n#scrubber {\n  width: 180px; height: 3px; cursor: pointer;\n  -webkit-appearance: none; appearance: none;\n  background: rgba(100,60,220,0.2); border-radius: 2px; outline: none;\n}\n#scrubber::-webkit-slider-thumb {\n  -webkit-appearance: none; width: 11px; height: 11px;\n  border-radius: 50%; background: #7858d0; cursor: pointer; border: none;\n}\n#t-disp { font-size: 9px; color: #484888; min-width: 36px; text-align: right; font-variant-numeric: tabular-nums; }\n#spd {\n  background: rgba(8,6,26,0.85); border: 1px solid rgba(100,60,220,0.3);\n  color: oklch(55% 0.12 186); font-size: 9px; font-family: 'Azeret Mono', 'Space Mono', monospace;\n  border-radius: 4px; padding: 2px 4px; cursor: pointer; outline: none;\n}\n#spd option { background: #0d0a20; }\n\n/* ── Detail panel ── */\n#dp-header {\n  padding: 14px 16px 10px;\n  border-bottom: 1px solid oklch(62% 0.2 186 / 0.18); flex-shrink: 0;\n}\n#dp-close {\n  float: right; background: none; border: none; color: #404070;\n  cursor: pointer; font-size: 13px; padding: 0; line-height: 1;\n}\n#dp-close:hover { color: #a090e0; }\n#dp-title { font-size: 9px; letter-spacing: 3px; color: #5050a0; margin-top: 2px; }\n#dp-emoji { font-size: 22px; display: block; margin-bottom: 4px; }\n#dp-body { flex: 1; overflow-y: auto; padding: 12px 16px; scrollbar-width: thin; scrollbar-color: oklch(62% 0.2 186 / 0.3) transparent; }\n#dp-body::-webkit-scrollbar { width: 4px; }\n#dp-body::-webkit-scrollbar-thumb { background: oklch(62% 0.2 186 / 0.3); border-radius: 2px; }\n.dp-section { margin-bottom: 14px; }\n.dp-section-title { font-size: 7.5px; letter-spacing: 3px; color: oklch(38% 0.07 186); margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid oklch(62% 0.2 186 / 0.15); }\n.dp-event { font-size: 9px; line-height: 1.6; color: #5060a0; margin-bottom: 4px; }\n.dp-event .ev-ts { color: #282855; }\n.dp-event .ev-type { color: inherit; font-weight: bold; }\n.dp-artifact { font-size: 9px; color: #6070a0; padding: 3px 6px; background: oklch(62% 0.2 186 / 0.08); border-radius: 3px; margin-bottom: 3px; }\n.dp-agent { display: inline-block; font-size: 8px; padding: 2px 7px; border-radius: 10px; margin: 2px 3px 2px 0; border: 1px solid oklch(62% 0.2 186 / 0.3); color: oklch(55% 0.09 186); }\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n</style>\n</head>\n<body>\n<div id=\"app\">\n  <!-- ── Left sidebar: session history ── -->\n  <div id=\"sidebar\">\n    <div id=\"sb-header\">\n      <div id=\"sb-title\">SESSIONS</div>\n      <select id=\"proj-filter\" onchange=\"applyProjectFilter(this.value)\" style=\"width:100%;margin-top:6px;background:oklch(12% 0.015 186);color:oklch(52% 0.1 186);border:1px solid oklch(62% 0.2 186 / 0.18);border-radius:3px;font-size:8px;letter-spacing:1px;padding:3px 4px;cursor:pointer\"><option value=\"\">ALL PROJECTS</option></select>\n      <div class=\"live-row\">\n        <div class=\"l-dot\" id=\"l-dot\"></div>\n        <span id=\"l-status\">OFFLINE</span>\n        <span id=\"l-agents\">0 agents</span>\n      </div>\n      <div id=\"git-user-row\">\n        <span id=\"git-user-icon\">⬡</span>\n        <span id=\"git-user-name\">—</span>\n      </div>\n      <div id=\"git-cwd-row\">\n        <span id=\"git-cwd-icon\">◎</span>\n        <span id=\"git-cwd-name\">—</span>\n      </div>\n    </div>\n    <div id=\"sb-sessions\">\n      <div id=\"sb-no-sessions\">No sessions yet.<br><br>Describe a goal and<br>Mastermind routes it<br>across specialist agents.<br><br><span style=\"color:oklch(56% 0.16 186);letter-spacing:1px\">/mastermind</span></div>\n    </div>\n    <button id=\"sb-movie-btn\" onclick=\"toggleMovieMode(currentSessionObj)\">▶ MOVIE MODE</button>\n  </div>\n\n  <!-- ── Stage ── -->\n  <div id=\"stage-wrap\">\n    <!-- SVG -->\n    <svg id=\"stage\" viewBox=\"0 0 960 720\" preserveAspectRatio=\"xMidYMid meet\">\n      <defs>\n        <filter id=\"glow\" x=\"-55%\" y=\"-55%\" width=\"210%\" height=\"210%\">\n          <feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"5\" result=\"b\"/>\n          <feMerge><feMergeNode in=\"b\"/><feMergeNode in=\"SourceGraphic\"/></feMerge>\n        </filter>\n        <filter id=\"bloom\" x=\"-100%\" y=\"-100%\" width=\"300%\" height=\"300%\">\n          <feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"15\" result=\"b\"/>\n          <feMerge><feMergeNode in=\"b\"/><feMergeNode in=\"SourceGraphic\"/></feMerge>\n        </filter>\n      </defs>\n      <rect width=\"960\" height=\"720\" fill=\"#07071a\"/>\n      <g id=\"stars\"></g>\n      <g id=\"net-edges\"></g>\n      <g id=\"net-particles\"></g>\n      <g id=\"net-nodes\"></g>\n    </svg>\n\n    <!-- Overlays -->\n    <div id=\"title-wrap\">\n      <div id=\"title-h1\">MASTERMIND</div>\n      <div id=\"title-sub\">AUTONOMOUS EXECUTION · 12 DOMAINS · PERSISTENT ORGS</div>\n    </div>\n\n    <div id=\"mode-banner\">LIVE</div>\n\n    <div id=\"prompt-box\">\n      <div id=\"p-tag\">USER PROMPT</div>\n      <div id=\"p-line\"><span id=\"p-text\"></span><span id=\"p-cursor\"></span></div>\n    </div>\n\n    <div id=\"activity-log\">\n      <div id=\"log-title\">ACTIVITY LOG</div>\n      <div id=\"log-entries\"></div>\n    </div>\n\n    <div id=\"ctrl\">\n      <button class=\"c-btn disabled\" id=\"btn-restart\" title=\"Restart\">↺</button>\n      <button class=\"c-btn disabled\" id=\"btn-play\" title=\"Play\">▶</button>\n      <button class=\"c-btn disabled\" id=\"btn-pause\" title=\"Pause\">⏸</button>\n      <input type=\"range\" id=\"scrubber\" min=\"0\" max=\"100\" value=\"0\" step=\"0.1\" disabled/>\n      <span id=\"t-disp\">—</span>\n      <select id=\"spd\">\n        <option value=\"0.5\">0.5×</option>\n        <option value=\"1\" selected>1×</option>\n        <option value=\"2\">2×</option>\n        <option value=\"3\">3×</option>\n      </select>\n    </div>\n  </div>\n\n  <!-- ── Right panel: session/domain detail ── -->\n  <div id=\"detail-panel\">\n    <div id=\"dp-header\">\n      <button id=\"dp-close\" onclick=\"closeDetail()\">✕</button>\n      <span id=\"dp-emoji\"></span>\n      <div id=\"dp-title\">SELECT A DOMAIN OR SESSION</div>\n    </div>\n    <div id=\"dp-body\"></div>\n  </div>\n</div>\n\n<script src=\"https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js\"></script>\n<script>\n'use strict';\n\n// ── Graph constants ──────────────────────────────────────────────────────────\nconst CX = 480, CY = 360;\nconst DOMAIN_COLORS = {\n  build:'#60a5fa', idea:'#fbbf24', marketing:'#f472b6', review:'#34d399',\n  research:'#a78bfa', content:'#fb923c', release:'#22d3ee', sales:'#f87171',\n  ops:'#4ade80', finance:'#fde68a', orgs:'#c084fc', default:'#00E5C8'\n};\nconst DOMAIN_EMOJIS = {\n  build:'⚙️', idea:'💡', marketing:'📣', review:'🔍', research:'🔬',\n  content:'✍️', release:'🚀', sales:'💼', ops:'⚡', finance:'💰', orgs:'🏛'\n};\nconst AGENT_EMOJIS = {\n  'coder':'⚙', 'architect':'🏗', 'tester':'🧪', 'reviewer':'🔍',\n  'researcher':'🔬', 'frontend-dev':'🎨', 'backend-dev':'⚡',\n  'coordinator':'🎯', 'planner':'📋', 'general-purpose':'🤖',\n  'frontend':'🎨', 'backend':'⚡', 'ml-developer':'🧠',\n  'security-architect':'🔒', 'sparc-coder':'💻', 'default':'◈'\n};\n\n// ── Node/edge model ───────────────────────────────────────────────────────────\nconst nodes = new Map();\nconst edges  = [];\nlet   rootId = null;\nlet   simActive = false;\n\n// ── SVG helpers ───────────────────────────────────────────────────────────────\nconst NS  = 'http://www.w3.org/2000/svg';\nconst mkN = (tag, a) => {\n  const el = document.createElementNS(NS, tag);\n  if (a) for (const [k,v] of Object.entries(a)) el.setAttribute(k, v);\n  return el;\n};\nconst starsG    = document.getElementById('stars');\nconst edgesG    = document.getElementById('net-edges');\nconst particlesG= document.getElementById('net-particles');\nconst nodesG    = document.getElementById('net-nodes');\n\n// ── Star field ────────────────────────────────────────────────────────────────\n(function buildStars() {\n  for (let i = 0; i < 170; i++) {\n    starsG.appendChild(mkN('circle', {\n      cx: (Math.random()*960).toFixed(1),\n      cy: (Math.random()*720).toFixed(1),\n      r:  (Math.random()<0.1 ? Math.random()*1.5+0.8 : Math.random()*0.8+0.15).toFixed(2),\n      fill: `rgba(160,150,255,${(Math.random()*0.35+0.08).toFixed(2)})`\n    }));\n  }\n  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {\n    gsap.to([...starsG.children], {\n      opacity: 'random(0.06,0.6)', duration: 'random(2,5)',\n      stagger:{ amount:16, from:'random', repeat:-1, yoyo:true, ease:'sine.inOut' }, delay:1\n    });\n  }\n})();\n\n// ── Hex helper ────────────────────────────────────────────────────────────────\nfunction hexPts(r) {\n  return Array.from({length:6},(_,i)=>{\n    const a=i*Math.PI/3-Math.PI/6;\n    return `${(r*Math.cos(a)).toFixed(1)},${(r*Math.sin(a)).toFixed(1)}`;\n  }).join(' ');\n}\n\n// ── Force simulation (Verlet) ─────────────────────────────────────────────────\nconst SPRING_K  = 0.030;\nconst REPULSION = 6000;\nconst DAMPING   = 0.78;\nconst REST_DIST = { root:0, domain:185, agent:68, org:160 };\n\nfunction forceStep() {\n  const arr = [...nodes.values()];\n  for (const n of arr) { n.ax=0; n.ay=0; }\n  for (let i=0; i<arr.length; i++) {\n    for (let j=i+1; j<arr.length; j++) {\n      const a=arr[i], b=arr[j];\n      const dx=b.x-a.x, dy=b.y-a.y;\n      const d2=dx*dx+dy*dy+1, d=Math.sqrt(d2);\n      const f=REPULSION/(d2*d);\n      if (!a.fixed){a.ax-=dx*f; a.ay-=dy*f;}\n      if (!b.fixed){b.ax+=dx*f; b.ay+=dy*f;}\n    }\n  }\n  for (const e of edges) {\n    const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n    if (!a||!b) continue;\n    const dx=b.x-a.x, dy=b.y-a.y;\n    const d=Math.sqrt(dx*dx+dy*dy)+0.001;\n    const rest=REST_DIST[b.type]??110;\n    const f=(d-rest)*SPRING_K;\n    if (!a.fixed){a.ax+=dx/d*f; a.ay+=dy/d*f;}\n    if (!b.fixed){b.ax-=dx/d*f; b.ay-=dy/d*f;}\n  }\n  for (const n of arr) {\n    if (n.fixed) continue;\n    n.vx=(n.vx+n.ax)*DAMPING;\n    n.vy=(n.vy+n.ay)*DAMPING;\n    n.x=Math.max(60,Math.min(900,n.x+n.vx));\n    n.y=Math.max(60,Math.min(660,n.y+n.vy));\n  }\n}\n\n// ── Node renderer ─────────────────────────────────────────────────────────────\nfunction buildNodeEl(n) {\n  const g=mkN('g',{transform:`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`});\n  g.style.opacity='0'; g.style.cursor='pointer';\n  if (n.type==='root') {\n    g.appendChild(mkN('circle',{r:'58',fill:'none',stroke:n.color,'stroke-width':'0.5',opacity:'0.15'}));\n    g.appendChild(mkN('circle',{r:'38',fill:'#070620',stroke:n.color,'stroke-width':'2.8',filter:'url(#glow)'}));\n    g.appendChild(mkN('circle',{r:'30',fill:'none',stroke:n.color,'stroke-width':'0.8',opacity:'0.35'}));\n    const hex=mkN('polygon',{points:hexPts(16),fill:'none',stroke:n.color,'stroke-width':'1.8',opacity:'0.75'});\n    g.appendChild(hex);\n    gsap.to(hex,{rotate:360,transformOrigin:'0 0',duration:24,repeat:-1,ease:'none'});\n    const lbl=mkN('text',{x:'0',y:'58','text-anchor':'middle','font-size':'6.5',fill:n.color,'letter-spacing':'2',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent='MASTERMIND'; g.appendChild(lbl);\n  } else if (n.type==='domain') {\n    g.appendChild(mkN('circle',{r:'44',fill:'none',stroke:n.color,'stroke-width':'0.5',opacity:'0.2'}));\n    g.appendChild(mkN('circle',{r:'30',fill:'#09071e',stroke:n.color,'stroke-width':'2.5',filter:'url(#glow)'}));\n    const emj=mkN('text',{x:'0',y:'9','text-anchor':'middle','font-size':'17'});\n    emj.textContent=n.emoji||'◈'; g.appendChild(emj);\n    const lbl=mkN('text',{x:'0',y:'45','text-anchor':'middle','font-size':'7',fill:n.color,'letter-spacing':'1.5',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent=n.label; g.appendChild(lbl);\n    const ring=mkN('circle',{r:'34',fill:'none',stroke:'#fbbf24','stroke-width':'2',opacity:'0',\n      transform:'rotate(-90)','stroke-dasharray':'213.6','stroke-dashoffset':'213.6','stroke-linecap':'round'});\n    ring.dataset.cring=n.id;\n    g.appendChild(ring);\n  } else if (n.type==='agent') {\n    g.appendChild(mkN('circle',{r:'20',fill:'#08061a',stroke:n.color,'stroke-width':'1.8',filter:'url(#glow)'}));\n    const emj=mkN('text',{x:'0',y:'5','text-anchor':'middle','font-size':'12'});\n    emj.textContent=n.emoji||'◈'; g.appendChild(emj);\n    const sl=n.label.length>11?n.label.slice(0,10)+'…':n.label;\n    const lbl=mkN('text',{x:'0',y:'31','text-anchor':'middle','font-size':'6',fill:n.color,'letter-spacing':'0.6',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent=sl; g.appendChild(lbl);\n  } else if (n.type==='org') {\n    g.appendChild(mkN('polygon',{points:'0,-38 32,0 0,38 -32,0',fill:'#09071e',stroke:n.color,'stroke-width':'2.5',filter:'url(#glow)'}));\n    const emj=mkN('text',{x:'0',y:'7','text-anchor':'middle','font-size':'16'});\n    emj.textContent='🏛'; g.appendChild(emj);\n    const lbl=mkN('text',{x:'0',y:'53','text-anchor':'middle','font-size':'6.5',fill:n.color,'letter-spacing':'1.5',\n      'font-family':\"'Azeret Mono','Space Mono',monospace\"});\n    lbl.textContent=n.label; g.appendChild(lbl);\n  }\n  g.appendChild(mkN('circle',{r:n.type==='agent'?'22':'50',fill:'transparent'}));\n  nodesG.appendChild(g);\n  n.el=g;\n  gsap.to(g,{opacity:1,duration:0.4,ease:'power2.out'});\n  gsap.from(g,{scale:0.15,transformOrigin:'0 0',duration:0.55,ease:'back.out(1.7)'});\n}\n\n// ── Edge renderer ─────────────────────────────────────────────────────────────\nfunction buildEdgeEl(e) {\n  const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n  if (!a||!b) return;\n  const g=mkN('g'); g.style.opacity='0';\n  const isIC=e.type==='intercom';\n  const path=mkN('path',{fill:'none',stroke:a.color,opacity:isIC?'0.75':'0.4',\n    'stroke-width':isIC?'1.5':'0.9','stroke-dasharray':isIC?'5 3':'none'});\n  g.appendChild(path);\n  if (isIC&&e.msg) {\n    const txt=mkN('text',{'font-size':'6.5',fill:a.color,\n      'font-family':\"'Azeret Mono','Space Mono',monospace\",'letter-spacing':'0.4',opacity:'0.8'});\n    txt.textContent=e.msg.length>24?e.msg.slice(0,23)+'…':e.msg;\n    g.appendChild(txt); e.msgEl=txt;\n  }\n  edgesG.insertBefore(g,edgesG.firstChild);\n  e.el=g; e.pathEl=path;\n  gsap.to(g,{opacity:1,duration:0.6,delay:0.12});\n  updateEdge(e);\n}\n\nfunction updateEdge(e) {\n  const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n  if (!a||!b||!e.pathEl) return;\n  if (e.type==='intercom') {\n    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2-65;\n    e.pathEl.setAttribute('d',`M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`);\n    if (e.msgEl){e.msgEl.setAttribute('x',(mx-22).toFixed(1));e.msgEl.setAttribute('y',(my-9).toFixed(1));}\n  } else {\n    e.pathEl.setAttribute('d',`M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`);\n  }\n}\n\n// ── Particle system ───────────────────────────────────────────────────────────\nconst PPC = 7;\nfunction spawnParticles(e) {\n  const col=(nodes.get(e.fromId)||{color:'#00E5C8'}).color;\n  e.ptcls=Array.from({length:PPC},(_,i)=>{\n    const dot=mkN('circle',{r:'2',fill:col,opacity:'0'});\n    particlesG.appendChild(dot);\n    return {el:dot, t:i/PPC};\n  });\n}\nfunction tickParticles() {\n  for (const e of edges) {\n    if (!e.ptcls) continue;\n    const a=nodes.get(e.fromId), b=nodes.get(e.toId);\n    if (!a||!b) continue;\n    for (const p of e.ptcls) {\n      p.t=(p.t+0.0045)%1;\n      const t=p.t;\n      let px,py;\n      if (e.type==='intercom') {\n        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2-65;\n        px=(1-t)*(1-t)*a.x+2*(1-t)*t*mx+t*t*b.x;\n        py=(1-t)*(1-t)*a.y+2*(1-t)*t*my+t*t*b.y;\n      } else {\n        px=a.x+(b.x-a.x)*t; py=a.y+(b.y-a.y)*t;\n      }\n      p.el.setAttribute('cx',px.toFixed(1));\n      p.el.setAttribute('cy',py.toFixed(1));\n      p.el.setAttribute('opacity',(Math.sin(t*Math.PI)*0.85).toFixed(2));\n    }\n  }\n}\n\n// ── RAF render loop ───────────────────────────────────────────────────────────\nlet rafLast=0;\nfunction rafLoop(ts) {\n  if (ts-rafLast>=16) {\n    if (simActive) forceStep();\n    for (const n of nodes.values()) {\n      if (n.el) n.el.setAttribute('transform',`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);\n    }\n    for (const e of edges) updateEdge(e);\n    tickParticles();\n    rafLast=ts;\n  }\n  requestAnimationFrame(rafLoop);\n}\nrequestAnimationFrame(rafLoop);\n\n// ── Graph mutation API ────────────────────────────────────────────────────────\nfunction gAddNode({id,type,domain,agentSlug,label,emoji,color,parentId,cmd}) {\n  if (nodes.has(id)) return nodes.get(id);\n  const par=parentId?nodes.get(parentId):null;\n  const px=par?par.x:CX, py=par?par.y:CY;\n  const ang=Math.random()*Math.PI*2;\n  const dist={root:0,domain:175,agent:75,org:155}[type]??120;\n  const n={\n    id,type,domain,agentSlug,\n    label:label||id,\n    emoji:emoji||(agentSlug?(AGENT_EMOJIS[agentSlug]||AGENT_EMOJIS.default):'◈'),\n    color:color||(domain?(DOMAIN_COLORS[domain]||DOMAIN_COLORS.default):DOMAIN_COLORS.default),\n    x:type==='root'?CX:px+Math.cos(ang)*dist+(Math.random()-.5)*28,\n    y:type==='root'?CY:py+Math.sin(ang)*dist+(Math.random()-.5)*28,\n    vx:0,vy:0,ax:0,ay:0,\n    fixed:type==='root',\n    parentId:parentId||null,\n    cmd:cmd||null,\n    done:false,\n    state:'active',ts:Date.now()\n  };\n  nodes.set(id,n);\n  simActive=nodes.size>1;\n  buildNodeEl(n);\n  return n;\n}\nfunction gAddEdge({id,fromId,toId,type,msg}) {\n  const eid=id||`${fromId}→${toId}`;\n  if (edges.find(e=>e.id===eid)) return;\n  const e={id:eid,fromId,toId,type:type||'activation',msg};\n  edges.push(e);\n  buildEdgeEl(e);\n  spawnParticles(e);\n}\nfunction gComplete(id) {\n  const cn = nodes.get(id); if (cn) cn.done = true;\n  const n=nodes.get(id);\n  if (!n||!n.el) return;\n  n.state='complete';\n  const circ=n.el.querySelector('circle[r=\"30\"]')||n.el.querySelector('circle');\n  if (circ) gsap.to(circ,{attr:{stroke:'#fbbf24'},duration:0.3,yoyo:true,repeat:2,\n    onComplete:()=>gsap.to(n.el,{opacity:0.65,duration:1.5})});\n  const ring=n.el.querySelector('[data-cring]');\n  if (ring) gsap.to(ring,{opacity:1,'stroke-dashoffset':0,duration:1.6,ease:'power1.inOut'});\n}\nfunction gClear() {\n  nodes.clear(); edges.length=0; rootId=null; simActive=false;\n  nodesG.innerHTML=''; edgesG.innerHTML=''; particlesG.innerHTML='';\n}\nfunction pulseRoot() {\n  const n=nodes.get(rootId);\n  if (!n||!n.el) return;\n  const c=n.el.querySelector('circle[r=\"38\"]');\n  if (c) gsap.to(c,{attr:{'stroke-width':6},duration:0.25,yoyo:true,repeat:1});\n}\n\n// ── Activity log ──────────────────────────────────────────────────────────────\nfunction addLog(tag,msg,color) {\n  const wrap=document.getElementById('log-entries');\n  const row=document.createElement('div');\n  row.className='log-row';\n  row.innerHTML=`<span class=\"log-tag\" style=\"color:${color}\">${tag}</span><span class=\"log-msg\">${msg}</span>`;\n  wrap.appendChild(row);\n  gsap.fromTo(row,{opacity:0},{opacity:1,duration:0.3});\n  const rows=wrap.querySelectorAll('.log-row');\n  if (rows.length>10) gsap.to(rows[0],{opacity:0,height:0,duration:0.22,onComplete:()=>rows[0].remove()});\n}\n\n// ── Movie mode ────────────────────────────────────────────────────────────────\nlet isMovieMode=false;\nlet movieTl=null;\n\nfunction buildMovieTl(sessionData) {\n  gClear();\n  document.getElementById('log-entries').innerHTML='';\n  document.getElementById('p-text').textContent='';\n  const evts=[...(sessionData&&sessionData.events?sessionData.events:[])].sort((a,b)=>(a.ts||0)-(b.ts||0));\n  const tl=gsap.timeline({paused:true,defaults:{ease:'power2.out'}});\n  if (!evts.length) {\n    tl.add(()=>addLog('[DEMO]','Select a session from the sidebar','#00E5C8'),0.2);\n    return tl;\n  }\n  evts.forEach((ev,i)=>{\n    const ev2=Object.assign({},ev);\n    tl.add(()=>handleGraphEvent(ev2), 0.3+i*0.75);\n  });\n  tl.duration(0.3+evts.length*0.75+1.5);\n  return tl;\n}\n\nfunction toggleMovieMode(sessionData) {\n  isMovieMode=!isMovieMode;\n  const btn=document.getElementById('sb-movie-btn');\n  const banner=document.getElementById('mode-banner');\n  const scrubEl=document.getElementById('scrubber');\n  const tDisp=document.getElementById('t-disp');\n  if (isMovieMode) {\n    btn.classList.add('active'); btn.textContent='■ EXIT MOVIE';\n    banner.textContent='MOVIE'; banner.classList.remove('live-mode');\n    ['btn-restart','btn-play','btn-pause'].forEach(id=>document.getElementById(id).classList.remove('disabled'));\n    scrubEl.disabled=false;\n    if (movieTl) movieTl.kill();\n    movieTl=buildMovieTl(sessionData);\n    document.getElementById('btn-play').onclick=()=>movieTl.resume();\n    document.getElementById('btn-pause').onclick=()=>movieTl.pause();\n    document.getElementById('btn-restart').onclick=()=>{\n      gClear(); document.getElementById('log-entries').innerHTML='';\n      movieTl=buildMovieTl(sessionData); movieTl.play();\n    };\n    document.getElementById('spd').onchange=e=>movieTl&&movieTl.timeScale(Number(e.target.value));\n    let scrubbing=false;\n    scrubEl.addEventListener('mousedown',()=>{scrubbing=true;movieTl&&movieTl.pause();});\n    scrubEl.addEventListener('mouseup',()=>{scrubbing=false;});\n    scrubEl.addEventListener('input',()=>{if(movieTl)movieTl.progress(Number(scrubEl.value)/100);tDisp.textContent=(movieTl?movieTl.time():0).toFixed(1)+'s';});\n    gsap.ticker.add(()=>{\n      if (!scrubbing&&movieTl&&movieTl.totalDuration()>0) {\n        scrubEl.value=movieTl.progress()*100;\n        tDisp.textContent=movieTl.time().toFixed(1)+'s';\n      }\n    });\n    gsap.to('#ctrl',{opacity:1,duration:0.35});\n    movieTl.play();\n  } else {\n    btn.classList.remove('active'); btn.textContent='▶ MOVIE MODE';\n    banner.textContent='LIVE'; banner.classList.add('live-mode');\n    ['btn-restart','btn-play','btn-pause'].forEach(id=>document.getElementById(id).classList.add('disabled'));\n    scrubEl.disabled=true; tDisp.textContent='—';\n    if (movieTl){movieTl.kill();movieTl=null;}\n    gsap.to('#ctrl',{opacity:0,duration:0.25});\n  }\n}\n\n// ── Core event dispatcher ─────────────────────────────────────────────────────\nfunction handleGraphEvent(ev) {\n  const {type,session,domain,agent,from,to,msg,cmd,prompt,status} = ev;\n  if (type==='session:start') {\n    gClear(); rootId=session;\n    gAddNode({id:session,type:'root',label:'MASTERMIND',color:DOMAIN_COLORS.default});\n    if (prompt) {\n      document.getElementById('p-tag').textContent='RUNNING';\n      document.getElementById('p-text').textContent=prompt;\n      gsap.to('#prompt-box',{opacity:1,duration:0.4});\n    }\n    gsap.to('#activity-log',{opacity:1,duration:0.4,delay:0.2});\n    gsap.to('#ctrl',{opacity:1,duration:0.4,delay:0.4});\n    addLog('[SESSION]',(prompt||session).slice(0,32),'#00E5C8');\n    refreshSessions();\n  } else if (type==='domain:dispatch') {\n    if (!domain||!rootId) return;\n    const domId=`${session}:${domain}`;\n    gAddNode({id:domId,type:'domain',domain,parentId:rootId,cmd:cmd||null,\n      label:domain.toUpperCase(),emoji:DOMAIN_EMOJIS[domain]||'◈'});\n    gAddEdge({fromId:rootId,toId:domId,type:'activation'});\n    pulseRoot();\n    addLog(`[${domain.toUpperCase()}]`,cmd||domain,DOMAIN_COLORS[domain]||'#00E5C8');\n  } else if (type==='agent:spawn') {\n    if (!domain||!rootId) return;\n    const domId=`${session}:${domain}`;\n    const agId=`${session}:${domain}:${agent||'agent'}:${Date.now()}`;\n    gAddNode({id:agId,type:'agent',domain,agentSlug:agent,parentId:domId,\n      label:agent||'agent',emoji:AGENT_EMOJIS[agent]||AGENT_EMOJIS.default});\n    gAddEdge({fromId:domId,toId:agId,type:'spawn'});\n    addLog(`[${(agent||'agent').slice(0,9)}]`,ev.task||agent||'',DOMAIN_COLORS[domain]||'#00E5C8');\n  } else if (type==='intercom') {\n    if (!from||!to||!rootId) return;\n    gAddEdge({id:`ic-${from}-${to}-${Date.now()}`,fromId:`${session}:${from}`,\n      toId:`${session}:${to}`,type:'intercom',msg});\n    addLog('[IC]',`${from}→${to}: ${msg||''}`,'#c084fc');\n  } else if (type==='domain:complete') {\n    gComplete(`${session}:${domain}`);\n    pulseRoot();\n    addLog(`[${(domain||'').toUpperCase()}]`,`done · ${status||'✓'}`,'#34d399');\n    refreshSessions();\n  } else if (type==='session:complete') {\n    for (const n of nodes.values()) {\n      if (n.el) gsap.to(n.el,{opacity:1,duration:0.3,yoyo:true,repeat:2,ease:'power1.inOut'});\n    }\n    addLog('[✓]',`complete — ${(ev.domains||[]).length||'all'} domains`,'#34d399');\n    setTimeout(()=>gsap.to('#prompt-box',{opacity:0,duration:1}),4000);\n    refreshSessions();\n  }\n}\n\n// ── Live event handler ────────────────────────────────────────────────────────\nfunction handleLiveEvent(ev) {\n  if (isMovieMode) return;\n  handleGraphEvent(ev);\n}\n\n// ── SSE event stream ───────────────────────────────────────────────────────────\nlet evtSource = null;\nfunction connectSSE() {\n  if (evtSource) evtSource.close();\n  evtSource = new EventSource('/api/mastermind-stream');\n  evtSource.onmessage = (e) => {\n    try {\n      const ev = JSON.parse(e.data);\n      handleLiveEvent(ev);\n    } catch (_) {}\n  };\n  evtSource.onerror = () => {\n    const dot = document.getElementById('l-dot');\n    if (dot) dot.classList.remove('on');\n    const st = document.getElementById('l-status');\n    if (st) st.textContent = 'RECONNECTING';\n    showStatusBanner('SSE disconnected — reconnecting in 4s');\n    setTimeout(connectSSE, 4000);\n  };\n}\n\n// ── Session sidebar ────────────────────────────────────────────────────────────\nlet currentSessionId = null;\n    let currentSessionObj = null;\n\nlet activeProjectFilter = '';\n\nfunction applyProjectFilter(val) {\n  activeProjectFilter = val;\n  refreshSessions();\n}\n\nasync function refreshSessions() {\n  try {\n    const url = activeProjectFilter\n      ? `/api/mastermind/sessions?project=${encodeURIComponent(activeProjectFilter)}`\n      : '/api/mastermind/sessions';\n    const res = await fetch(url);\n    const sessions = await res.json();\n    // Populate project filter options\n    const sel = document.getElementById('proj-filter');\n    if (sel) {\n      const projects = [...new Set(sessions.map(s => s.project).filter(Boolean))];\n      const current = sel.value;\n      sel.innerHTML = '<option value=\"\">ALL PROJECTS</option>' +\n        projects.map(p => {\n          const name = p.split('/').pop();\n          return `<option value=\"${p}\" ${p===current?'selected':''}>${name}</option>`;\n        }).join('');\n    }\n    renderSessions(sessions);\n  } catch (_) {}\n}\n\nfunction renderSessions(sessions) {\n  const wrap = document.getElementById('sb-sessions');\n  const noSess = document.getElementById('sb-no-sessions');\n  if (!sessions || !sessions.length) {\n    if (noSess) noSess.style.display = 'block';\n    const items = wrap.querySelectorAll('.sess-item');\n    items.forEach(i => i.remove());\n    return;\n  }\n  if (noSess) noSess.style.display = 'none';\n  // Remove old items\n  wrap.querySelectorAll('.sess-item').forEach(el => el.remove());\n  sessions.forEach(s => {\n    const item = document.createElement('div');\n    item.className = 'sess-item' + (s.status === 'running' ? ' running' : '') + (s.id === currentSessionId ? ' active' : '');\n    const ts = new Date(s.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});\n    const date = new Date(s.ts).toLocaleDateString([], {month:'short',day:'numeric'});\n    const elapsed = s.endTs ? ((s.endTs - s.ts)/1000).toFixed(0)+'s' : (s.status==='running'?'RUNNING…':'?');\n    const projName = s.project ? s.project.split('/').pop() : '';\n    item.innerHTML = `\n      ${projName ? `<div class=\"sess-project\">◈ ${projName}</div>` : ''}\n      <div class=\"sess-ts\">${date} ${ts} · ${elapsed}</div>\n      <div class=\"sess-prompt\">${s.prompt||'(no prompt)'}</div>\n      <div class=\"sess-badges\">\n        <span class=\"sess-badge ${s.status==='running'?'running-badge':''}\">${s.status||'?'}</span>\n        ${(s.domains||[]).slice(0,4).map(d=>`<span class=\"sess-badge\">${d}</span>`).join('')}\n        ${(s.domains||[]).length>4?`<span class=\"sess-badge\">+${s.domains.length-4}</span>`:''}\n        <a class=\"sess-trace-link\" href=\"/api/mastermind/session/${s.id}/trace\" target=\"_blank\" title=\"View raw trace\" onclick=\"event.stopPropagation()\">trace↗</a>\n      </div>`;\n    item.addEventListener('click', () => {\n      wrap.querySelectorAll('.sess-item').forEach(x=>x.classList.remove('active'));\n      item.classList.add('active');\n      currentSessionId = s.id;\n      currentSessionObj = s;\n      openSessionDetail(s);\n    });\n    wrap.appendChild(item);\n  });\n}\n\n// ── Detail panel ───────────────────────────────────────────────────────────────\nfunction openDomainDetail(d) {\n  const panel = document.getElementById('detail-panel');\n  document.getElementById('dp-emoji').textContent = d.emoji || '◈';\n  document.getElementById('dp-title').textContent = `DOMAIN · ${d.label}`;\n  const body = document.getElementById('dp-body');\n  // Gather events from current session for this domain\n  const sessEvts = (currentSessionObj && currentSessionObj.events) ? currentSessionObj.events : [];\n  const domEvts = sessEvts.filter(e => e.domain === d.domain || e.domain === (d.label||'').toLowerCase());\n  const spawnEvts = domEvts.filter(e => e.type === 'agent:spawn');\n  const artifacts = domEvts.flatMap(e => e.artifacts || []);\n  // Also collect child agent nodes\n  const agentNodes = [];\n  nodes.forEach(n => { if (n.parentId === d.id) agentNodes.push(n); });\n  body.innerHTML = `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">DOMAIN INFO</div>\n      <div class=\"dp-event\"><span class=\"ev-type\" style=\"color:${d.color}\">${d.emoji||'◈'} ${d.label}</span></div>\n      ${d.cmd ? `<div class=\"dp-event\">Command: <span style=\"color:#7080c0\">${d.cmd}</span></div>` : ''}\n      <div class=\"dp-event\">Status: <span style=\"color:${d.done?'#40e880':'#28c068'}\">${d.done?'COMPLETE':'RUNNING'}</span></div>\n      <div class=\"dp-event\">Agents spawned: <span style=\"color:${d.color}\">${agentNodes.length}</span></div>\n    </div>\n    ${agentNodes.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">AGENTS</div>\n      ${agentNodes.map(a => `<div class=\"dp-event\"><span class=\"ev-type\" style=\"color:${a.color||d.color}\">${a.emoji||'◈'} ${a.label}</span></div>`).join('')}\n    </div>` : ''}\n    ${spawnEvts.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">TASKS</div>\n      ${spawnEvts.map(e => `<div class=\"dp-event\" style=\"color:#506080;font-size:8px;white-space:normal;word-break:break-word;line-height:1.5\">${e.agent ? '<b>'+e.agent+'</b>: ' : ''}${(e.task||'').slice(0,120)}</div>`).join('')}\n    </div>` : ''}\n    ${artifacts.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">ARTIFACTS</div>\n      ${artifacts.map(a => `<div class=\"dp-artifact\">📄 ${a}</div>`).join('')}\n    </div>` : ''}\n    ${domEvts.length > 0 ? `\n    <div class=\"dp-section\">\n      <div class=\"dp-section-title\">RECENT EVENTS</div>\n      ${domEvts.slice(-8).map(e => {\n        const ts = new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});\n        return `<div class=\"dp-event\"><span class=\"ev-ts\">${ts}</span> <span class=\"ev-type\" style=\"color:${d.color}\">${e.type}</span>${e.cmd?' '+e.cmd:e.agent?' '+e.agent:''}</div>`;\n      }).join('')}\n    </div>` : ''}\n  `;\n  panel.classList.add('open');\n}\n\nasync function openSessionDetail(s) {\n  const panel = document.getElementById('detail-panel');\n  document.getElementById('dp-emoji').textContent = '📋';\n  document.getElementById('dp-title').textContent = 'SESSION DETAIL';\n  const body = document.getElementById('dp-body');\n  body.innerHTML = '<div style=\"color:#303060;font-size:9px;padding:8px\">Loading…</div>';\n  panel.classList.add('open');\n  try {\n    const res = await fetch(`/api/mastermind/session/${s.id}`);\n    const full = await res.json();\n    if (!full) { body.innerHTML = '<div style=\"color:#303060;font-size:9px\">Session not found.</div>'; return; }\n    const ts = new Date(full.ts).toLocaleString();\n    const elapsed = full.endTs ? ((full.endTs - full.ts)/1000).toFixed(1)+'s' : 'running';\n    const evts = full.events || [];\n    const domainSet = full.domains || [];\n    body.innerHTML = `\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">OVERVIEW</div>\n        <div class=\"dp-event\">Started: <span style=\"color:#6060a0\">${ts}</span></div>\n        <div class=\"dp-event\">Duration: <span style=\"color:#6060a0\">${elapsed}</span></div>\n        <div class=\"dp-event\">Status: <span style=\"color:${full.status==='complete'?'#40e880':full.status==='running'?'#28c068':'#f87171'}\">${full.status||'?'}</span></div>\n        <div class=\"dp-event\">Domains: <span style=\"color:#8080c0\">${domainSet.join(', ')||'—'}</span></div>\n      </div>\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">PROMPT</div>\n        <div class=\"dp-event\" style=\"color:oklch(58% 0.09 186);word-break:break-all;white-space:normal;line-height:1.6\">${full.prompt||'—'}</div>\n      </div>\n      ${domainSet.length ? `\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">ACTIVE DOMAINS</div>\n        ${domainSet.map(did => {\n          const color = DOMAIN_COLORS[did] || '#8080c0';\n          const emoji = DOMAIN_EMOJIS[did] || '◈';\n          const label = (did||'').toUpperCase();\n          return `<div class=\"dp-event\"><span style=\"color:${color}\">${emoji} ${label}</span></div>`;\n        }).join('')}\n      </div>` : ''}\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">EVENT TIMELINE (${evts.length})</div>\n        ${evts.map(e => {\n          const et = new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});\n          const color = e.domain ? (DOMAIN_COLORS[e.domain] || '#6060a0') : '#6060a0';\n          let detail = '';\n          if (e.type === 'session:start') detail = `<span style=\"color:#5050a0;font-size:8px;word-break:break-all\">${e.prompt||''}</span>`;\n          else if (e.type === 'domain:dispatch') detail = `<span style=\"color:#5060a0;font-size:8px\">${e.cmd||''}</span>`;\n          else if (e.type === 'agent:spawn') detail = `<span style=\"color:#507090;font-size:8px\">agent: <b>${e.agent||''}</b> — ${(e.task||'').slice(0,50)}</span>`;\n          else if (e.type === 'intercom') detail = `<span style=\"color:#506070;font-size:8px\">${e.from||'?'} → ${e.to||'?'}: ${e.msg||''}</span>`;\n          else if (e.type === 'domain:complete') {\n            const arts = (e.artifacts||[]).map(a=>`<span style=\"color:#407050;font-size:7px\">📄 ${a}</span>`).join(' ');\n            detail = `<span style=\"color:#406050;font-size:8px\">status: ${e.status||'?'}</span>${arts?' '+arts:''}`;\n          }\n          else if (e.type === 'session:complete') detail = `<span style=\"color:#405080;font-size:8px\">domains: ${(e.domains||[]).join(', ')}</span>`;\n          return `<div class=\"dp-event\" style=\"flex-direction:column;align-items:flex-start;gap:1px\"><div><span class=\"ev-ts\">${et}</span> <span class=\"ev-type\" style=\"color:${color}\">${e.type}</span>${e.domain?' <span style=\"color:#404060;font-size:8px\">['+e.domain+']</span>':''}</div>${detail?'<div style=\"padding-left:4px\">'+detail+'</div>':''}</div>`;\n        }).join('')}\n      </div>\n      <div class=\"dp-section\">\n        <div class=\"dp-section-title\">EXPORT</div>\n        <div style=\"display:flex;gap:6px;flex-wrap:wrap\">\n          <a class=\"dp-export-btn\" href=\"/api/mastermind/session/${full.id}/trace\" target=\"_blank\">📄 View Trace</a>\n          <button class=\"dp-export-btn\" onclick=\"downloadSession('${full.id}')\">⬇ Download JSON</button>\n        </div>\n      </div>\n    `;\n  } catch(err) {\n    body.innerHTML = `<div style=\"color:#a03030;font-size:9px\">${err.message}</div>`;\n  }\n}\n\nfunction closeDetail() {\n  document.getElementById('detail-panel').classList.remove('open');\n  currentSessionId = null;\n  document.querySelectorAll('.sess-item').forEach(x=>x.classList.remove('active'));\n}\n\nasync function downloadSession(id) {\n  const res = await fetch(`/api/mastermind/session/${id}`);\n  const data = await res.json();\n  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});\n  const a = document.createElement('a');\n  a.href = URL.createObjectURL(blob);\n  a.download = `${id}.json`;\n  a.click();\n  URL.revokeObjectURL(a.href);\n}\n\n// ── Live data polling for status bar ──────────────────────────────────────────\nasync function pollStatus() {\n  try {\n    const res = await fetch('/api/data');\n    if (!res.ok) return;\n    const data = await res.json();\n    const active = !!data?.swarm?.activity?.swarm?.active;\n    const dot = document.getElementById('l-dot');\n    dot.classList.toggle('on', active);\n    document.getElementById('l-status').textContent = active ? 'LIVE' : 'IDLE';\n    const n = data?.swarm?.state?.agentPlan?.length || 0;\n    document.getElementById('l-agents').textContent = n + ' agent' + (n!==1?'s':'');\n    // Highlight last routed domain\n    const route = data?.hooks?.lastRoute || '';\n    if (route && !isMovieMode) {\n      const hit = DOMAINS.find(d => route.toLowerCase().includes(d.id));\n      if (hit) {\n        gsap.to(`#gr-${hit.id}`, { opacity:0.85, attr:{r:52}, duration:0.35 });\n        gsap.to(`#gr-${hit.id}`, { opacity:0.2, attr:{r:44}, duration:1.8, delay:0.35 });\n      }\n    }\n  } catch (_) {}\n}\n\n\nfunction showStatusBanner(msg) {\n  let b = document.getElementById('status-banner');\n  if (!b) {\n    b = document.createElement('div'); b.id = 'status-banner';\n    b.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:5px 14px;background:oklch(24% 0.05 186);border-bottom:1px solid oklch(68% 0.18 186 / 0.35);color:oklch(70% 0.05 186);font-size:9px;letter-spacing:1.5px;text-align:center;z-index:9999;transition:opacity 0.5s;pointer-events:none;';\n    document.body.appendChild(b);\n  }\n  b.textContent = msg; b.style.opacity = '1';\n  clearTimeout(b._t); b._t = setTimeout(() => { b.style.opacity = '0'; }, 5000);\n}\n\n// ── Bootstrap ──────────────────────────────────────────────────────────────────\nconnectSSE();\nrefreshSessions();\npollStatus();\nfetch('/api/git-user').then(r=>r.json()).then(u=>{\n  if (u.name) document.getElementById('git-user-name').textContent = u.name;\n  if (u.cwd) {\n    const parts = u.cwd.replace(/\\\\/g, '/').split('/');\n    document.getElementById('git-cwd-name').textContent = parts.slice(-2).join('/');\n    document.getElementById('git-cwd-name').title = u.cwd;\n  }\n}).catch(()=>{});\nsetInterval(pollStatus, 4000);\nsetInterval(refreshSessions, 8000);\n\n// Set initial live mode banner\ndocument.getElementById('mode-banner').classList.add('live-mode');\n</script>\n</body>\n</html>\n";


// ─── Session JSONL parser ────────────────────────────────────────────────────
function categorizeTool(name) {
  if (['Read','Write','Edit','MultiEdit','Glob','Grep','LS'].includes(name)) return 'file';
  if (name === 'Bash') return 'bash';
  if (['Agent','Task'].includes(name)) return 'agent';
  if (name.startsWith('mcp__monobrain__memory') || name.startsWith('mcp__monobrain__agentdb')) return 'memory';
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
  if (name.startsWith('mcp__monobrain__memory')) return name.replace('mcp__monobrain__memory_', 'mem:');
  if (name.startsWith('mcp__')) return name.replace('mcp__monobrain__', '⬡ ').replace('mcp__', '⬡ ').slice(0, 40);
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
      f.includes('ruvector.db') || f.includes('ranked-context') ||
      (f.includes('/memory/') && f.endsWith('.md'))) return ['memory', 'sessions'];
  if (f.includes('palace') || f.includes('drawers') || f.includes('identity')) return ['memory', 'sessions'];
  if (f.includes('ddd') || f.includes('learning') || f.includes('audit')) return ['metrics'];
  if (f.endsWith('.jsonl') || f.includes('sessions')) return ['sessions'];
  return ['sessions', 'swarm', 'agents', 'tokens', 'hooks'];
}

// SSE client registry
const sseClients = new Set();
// Mastermind real-time event stream clients
const mmSseClients = new Set();

// Server state
let running = false;
let currentPort = null;
let currentUrl = null;
let activeServer = null;
const activeWatchers = [];

/**
 * Broadcasts a data payload to all connected SSE clients.
 * Silently removes clients that have disconnected.
 */
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

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
export async function startServer({ port = 4242, projectDir, openBrowser = true } = {}) {
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

    // --------------------------------------------------------- GET /api/git-user
    if (req.method === 'GET' && url === '/api/git-user') {
      try {
        const { execSync: gitExec } = await import('child_process');
        const cwd = projectDir || process.cwd();
        const name = gitExec('git config user.name', { cwd, encoding: 'utf8' }).trim();
        const email = gitExec('git config user.email', { cwd, encoding: 'utf8' }).trim();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ name, email, cwd }));
      } catch (_) {
        const cwd2 = projectDir || process.cwd();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ name: '', email: '', cwd: cwd2 }));
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
        const raw = fs.readFileSync(file, 'utf8');
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
            .slice(0, 15);
        } catch {}

        const sessions = [];
        for (const { f, mtime } of sessionFiles) {
          const fp = path.join(projectClaudeDir, f);
          const id = f.replace('.jsonl', '');
          let lastPrompt = '', summaries = [], totalDurationMs = 0, totalMessages = 0, firstTs = null, lastTs = null;
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            let pendingCompact = false;
            for (const line of lines) {
              let e; try { e = JSON.parse(line); } catch { continue; }
              if (e.timestamp) { if (!firstTs) firstTs = e.timestamp; lastTs = e.timestamp; }
              if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt;
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
              if (e.type === 'system' && e.subtype === 'turn_duration') {
                totalDurationMs += e.durationMs || 0;
                if ((e.messageCount || 0) > totalMessages) totalMessages = e.messageCount;
              }
            }
          } catch {}
          sessions.push({ id, mtime, firstTs, lastTs, lastPrompt, summaries, totalDurationMs, totalMessages });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ sessions }));
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
          return { filename: fname, name, description, type, body, mtime: stat ? stat.mtimeMs : null };
        }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ memories, memDir }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ------------------------------------------------------- PUT /api/memory-file
    if (req.method === 'PUT' && url === '/api/memory-file') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
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
      req.on('data', chunk => { body += chunk; });
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

    // ---------------------------------------------------------- GET /api/loops
    if (req.method === 'GET' && url === '/api/loops') {
      try {
        const cwd = projectDir || process.cwd();
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
                    const type = (finalMax > 0 || /repeat|loop/i.test(prompt)) ? 'repeat' : 'do';
                    loopEntry = {
                      id: sessionId,
                      sessionId,
                      type,
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

        loops.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ loops }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    // ---------------------------------------------------------- POST /api/loops/stop
    if (req.method === 'POST' && url === '/api/loops/stop') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
          const loopsDir = path.join(projectDir || process.cwd(), '.monomind', 'loops');
          fs.mkdirSync(loopsDir, { recursive: true });
          fs.writeFileSync(path.join(loopsDir, `${id}.stop`), `stop-requested-${Date.now()}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    // ------------------------------------------------------- DELETE /api/knowledge-chunk
    if (req.method === 'DELETE' && url === '/api/knowledge-chunk') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
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
      req.on('data', chunk => { body += chunk; });
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
          const { openDb, closeDb, toHtml } = await import('@monoes/monograph');
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
          const { openDb, closeDb } = await import('@monoes/monograph');
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
          const { openDb, closeDb } = await import('@monoes/monograph');
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
          const { openDb, closeDb, isFileCached, updateFileCache, hashFileContent } = await import('@monoes/monograph');
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
        const { openDb, closeDb } = await import('@monoes/monograph');
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
        const q = (qs.get('q') || '').trim();
        const limit = Math.min(100, parseInt(qs.get('limit') || '50', 10));
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q=' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ nodes: [] })); return; }
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
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
        const { openDb, closeDb } = await import('@monoes/monograph');
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
        const { openDb, closeDb } = await import('@monoes/monograph');
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
        const q = qs.get('q') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q= parameter' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, result: 'Graph not built yet. Run: monomind monograph build' })); return; }
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
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
        const nodeQ = qs.get('node') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!nodeQ) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?node= parameter' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, explanation: 'Graph not built yet. Run: monomind monograph build' })); return; }
        const { openDb, closeDb, ftsSearch } = await import('@monoes/monograph');
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
        const from = qs.get('from') || '';
        const to = qs.get('to') || '';
        const d = path.resolve(dir || process.cwd());
        const dbPath = path.join(d, '.monomind', 'monograph.db');
        if (!from || !to) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?from= and ?to= parameters' })); return; }
        if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ success: false, path: 'Graph not built yet.' })); return; }
        const { openDb, closeDb, getShortestPath, ftsSearch } = await import('@monoes/monograph');
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
      req.on('data', c => body += c);
      req.on('end', async () => {
        const json = res => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); };
        const ok = (data) => { json(res); res.end(JSON.stringify({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })); };
        const err = (msg) => { json(res); res.end(JSON.stringify({ error: msg })); };
        try {
          const { tool, input = {} } = JSON.parse(body);
          const qs2 = new URL(req.url, 'http://localhost').searchParams;
          const dir2 = qs2.get('dir') || projectDir;
          const d2 = path.resolve(dir2 || process.cwd());
          const dbPath2 = path.join(d2, '.monomind', 'monograph.db');
          if (!fs.existsSync(dbPath2)) { err('monograph.db not found — run monograph build first'); return; }
          const { openDb, closeDb, ftsSearch, getShortestPath, countNodes, countEdges } = await import('@monoes/monograph');
          const db2 = openDb(dbPath2);
          try {
            if (tool === 'monograph_stats') {
              const n = countNodes(db2), e = countEdges(db2);
              ok(`nodes: ${n}\nedges: ${e}`);
            } else if (tool === 'monograph_cypher') {
              // Translate basic MATCH (n:Label) queries to SQL
              const q = (input.query || '').trim();
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
              const sym = input.symbolName || '';
              if (!sym) { ok('Provide symbolName to rename'); return; }
              const hits = ftsSearch(db2, sym, 20);
              ok(`Found ${hits.length} occurrences of "${sym}":\n` + hits.map(h => `  ${h.filePath || '?'}:${h.startLine || '?'} — ${h.name}`).join('\n'));
            } else if (tool === 'monograph_impact') {
              const target = input.target || '';
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
              const id = input.id || '';
              const hits = ftsSearch(db2, id, 5);
              if (!hits.length) { ok(`Node not found: ${id}`); return; }
              const node = hits[0];
              const outEdges = db2.prepare('SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20').all(node.id);
              const inEdges = db2.prepare('SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ? LIMIT 20').all(node.id);
              ok(`# ${node.name} (${node.label})\nFile: ${node.filePath || '?'}\n\n**Imports / depends on (${outEdges.length}):**\n${outEdges.map(e => `  → ${e.name} [${e.relation}]`).join('\n') || '  (none)'}\n\n**Used by / depended on by (${inEdges.length}):**\n${inEdges.map(e => `  ← ${e.name} [${e.relation}]`).join('\n') || '  (none)'}`);
            } else if (tool === 'monograph_query' || tool === 'monograph_suggest') {
              const q2 = input.query || input.task || '';
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
          if (name.startsWith('mcp__monobrain__memory') || name.startsWith('mcp__monobrain__agentdb')) return 'memory';
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
          if (stat.size > JSONL_SIZE_CAP) {
            nodes.push({ id: sid, type: 'session', label: sid.slice(0,8), turns: 0, totalTools: 0,
              toolCounts: {}, cost: 0, mtime: stat.mtimeMs, size: stat.size, agentSpawns: {}, truncated: true });
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
              if (e.type === 'user') turns++;
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
              }
              if (e.costUSD) totalCost += e.costUSD;
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
        const swarmId = qs.get('swarmId') || undefined;
        const agentId = qs.get('agentId') || undefined;
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
          res.end(JSON.stringify({ totalCost: summary.todayCost || 0, totalCalls: summary.todayCalls || 0, totalIn: 0, totalOut: 0, totalCR: 0, totalCW: 0, projects: [], modelBreakdown: {}, categoryBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, periodLabel: period }));
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
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
          res.end(JSON.stringify({ totalCost, totalCalls, totalIn, totalOut, totalCR, totalCW, projects, modelBreakdown, categoryBreakdown, toolBreakdown, mcpBreakdown, periodLabel: period }));
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

      sseClients.add(res);

      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
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

    // ------------------------------------------------- Org management
    // GET /api/orgs — list all saved org configs
    if (req.method === 'GET' && url === '/api/orgs') {
      try {
        const orgsDir = path.join(projectDir || process.cwd(), '.monomind', 'orgs');
        let orgs = [];
        if (fs.existsSync(orgsDir)) {
          const files = fs.readdirSync(orgsDir).filter(f => f.endsWith('.json'));
          // Read events file once, outside the per-org loop
          let recentLines = [];
          try {
            const evFile = path.join(projectDir || process.cwd(), 'data', 'mastermind-events.jsonl');
            if (fs.existsSync(evFile)) {
              // Read only the last 64 KB to bound cost on large files
              const stat = fs.statSync(evFile);
              const TAIL = 65536;
              const fd = fs.openSync(evFile, 'r');
              const buf = Buffer.alloc(Math.min(TAIL, stat.size));
              try {
                fs.readSync(fd, buf, 0, buf.length, Math.max(0, stat.size - buf.length));
              } finally {
                fs.closeSync(fd);
              }
              recentLines = buf.toString('utf8').split('\n').filter(Boolean).reverse();
            }
          } catch(_) {}
          for (const f of files) {
            try {
              const cfg = JSON.parse(fs.readFileSync(path.join(orgsDir, f), 'utf8'));
              let running = false;
              const lastStart = recentLines.find(l => { try { const e = JSON.parse(l); return e.type === 'org:start' && e.org === cfg.name; } catch(_) { return false; } });
              const lastStop = recentLines.find(l => { try { const e = JSON.parse(l); return (e.type === 'org:stop' || e.type === 'org:complete') && e.org === cfg.name; } catch(_) { return false; } });
              if (lastStart) {
                const startTs = JSON.parse(lastStart).ts || 0;
                const stopTs = lastStop ? (JSON.parse(lastStop).ts || 0) : 0;
                running = startTs > stopTs;
              }
              orgs.push({ name: cfg.name, goal: cfg.goal, roles: cfg.roles?.length || 0, topology: cfg.topology, created_at: cfg.created_at, running });
            } catch(_) {}
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(orgs));
      } catch(_) { res.writeHead(500); res.end('[]'); }
      return;
    }

    // GET /api/orgs/:name — get specific org config (exact path: /api/orgs/<slug>)
    if (req.method === 'GET' && /^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}$/i.test(url)) {
      try {
        const orgName = decodeURIComponent(url.slice('/api/orgs/'.length));
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const f = path.join(projectDir || process.cwd(), '.monomind', 'orgs', `${orgName}.json`);
        if (!fs.existsSync(f)) { res.writeHead(404); res.end('{"error":"not found"}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(fs.readFileSync(f, 'utf8'));
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // POST /api/orgs/:name/stop — send stop signal to a running org
    if (req.method === 'POST' && url.match(/^\/api\/orgs\/[a-z0-9][a-z0-9_-]{0,63}\/stop$/i)) {
      try {
        const orgName = decodeURIComponent(url.split('/')[3]);
        if (orgName.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) { res.writeHead(400); res.end('Invalid org name'); return; }
        const stopEvent = { type: 'org:stop', org: orgName, ts: Date.now() };
        const dataDir = path.join(projectDir || process.cwd(), 'data');
        try { fs.mkdirSync(dataDir, { recursive: true }); } catch(_) {}
        try { fs.appendFileSync(path.join(dataDir, 'mastermind-events.jsonl'), JSON.stringify(stopEvent) + '\n'); } catch(_) {}
        // Write stop marker file for boss agent to detect
        try {
          const stopDir = path.join(projectDir || process.cwd(), '.monomind', 'orgs', '.stops');
          fs.mkdirSync(stopDir, { recursive: true });
          fs.writeFileSync(path.join(stopDir, `${orgName}.stop`), String(Date.now()));
        } catch(_) {}
        const msg = `data: ${JSON.stringify(stopEvent)}\n\n`;
        for (const c of mmSseClients) { try { c.write(msg); } catch(_) { mmSseClients.delete(c); } }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end('{"ok":true}');
      } catch(_) { res.writeHead(500); res.end('{}'); }
      return;
    }

    // ------------------------------------------------- Mastermind event system
    // POST /api/mastermind/event — ingest event from mastermind skill
    if (req.method === 'POST' && url === '/api/mastermind/event') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let event = {};
      try { event = JSON.parse(body); } catch (_) {}
      event.ts = event.ts || Date.now();
      // Use project path from event if provided (multi-project support)
      const eventProject = event.project && path.isAbsolute(event.project) ? event.project : null;
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
      try { fs.appendFileSync(path.join(dataDir, 'mastermind-events.jsonl'), JSON.stringify(event) + '\n'); } catch (_) {}
      // Persist session
      try {
        const sessFile = path.join(dataDir, 'mastermind-sessions.json');
        let sessions = [];
        try { sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8')); } catch (_) {}
        if (event.type === 'session:start') {
          sessions.unshift({ id: event.session, ts: event.ts, prompt: event.prompt || '',
            status: 'running', domains: [], events: [event], project: root });
        } else {
          const s = sessions.find(s => s.id === event.session);
          if (s) {
            (s.events = s.events || []).push(event);
            if (event.type === 'domain:dispatch' && event.domain && !s.domains.includes(event.domain))
              s.domains.push(event.domain);
            if (event.type === 'session:complete') { s.status = event.status || 'complete'; s.endTs = event.ts; }
          }
        }
        fs.writeFileSync(sessFile, JSON.stringify(sessions.slice(0, 50), null, 2));
        // Also write individual session file for direct traceability
        const sessionObj = sessions.find(s => s.id === event.session);
        if (sessionObj) {
          const sessDir = path.join(dataDir, 'sessions');
          try { fs.mkdirSync(sessDir, { recursive: true }); } catch (_) {}
          try { fs.writeFileSync(path.join(sessDir, `${event.session}.json`), JSON.stringify(sessionObj, null, 2)); } catch (_) {}
        }
      } catch (_) {}
      // For org:stop events, write a stop marker the boss agent can detect
      if (event.type === 'org:stop' && event.org) {
        try {
          const orgName = String(event.org).trim();
          // Validate before any filesystem use — reject rather than strip
          if (orgName.length > 0 && orgName.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
            const stopDir = path.join(root, '.monomind', 'orgs', '.stops');
            fs.mkdirSync(stopDir, { recursive: true });
            fs.writeFileSync(path.join(stopDir, `${orgName}.stop`), String(Date.now()));
          }
        } catch (_) {}
      }
      // Broadcast to all mastermind SSE clients
      const msg = `data: ${JSON.stringify(event)}\n\n`;
      for (const c of mmSseClients) { try { c.write(msg); } catch (_) { mmSseClients.delete(c); } }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{"ok":true}');
      return;
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
      mmSseClients.add(res);
      // Replay last 50 events from disk
      try {
        const root2 = projectDir || process.cwd();
        const evFile = path.join(root2, 'data', 'mastermind-events.jsonl');
        const lines = fs.readFileSync(evFile, 'utf8').trim().split('\n').filter(Boolean).slice(-50);
        for (const l of lines) res.write(`data: ${l}\n\n`);
      } catch (_) {}
      const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { clearInterval(ka); mmSseClients.delete(res); } }, 20000);
      req.on('close', () => { mmSseClients.delete(res); clearInterval(ka); });
      return;
    }

    // GET /api/mastermind/sessions
    if (req.method === 'GET' && url.startsWith('/api/mastermind/sessions')) {
      try {
        const qp = new URL('http://x' + req.url).searchParams;
        const filterProject = qp.get('project');
        const serverRoot = projectDir || process.cwd();
        // Collect all project dirs to aggregate
        const projectDirs = new Set([serverRoot]);
        try {
          const known = JSON.parse(fs.readFileSync(path.join(serverRoot, 'data', 'known-projects.json'), 'utf8'));
          known.forEach(p => projectDirs.add(p));
        } catch (_) {}
        // Load and merge sessions from all dirs
        let allSessions = [];
        for (const pd of projectDirs) {
          if (filterProject && pd !== filterProject) continue;
          const f = path.join(pd, 'data', 'mastermind-sessions.json');
          if (!fs.existsSync(f)) continue;
          try {
            const s = JSON.parse(fs.readFileSync(f, 'utf8'));
            // Tag each session with its project if not already tagged
            s.forEach(sess => { if (!sess.project) sess.project = pd; });
            allSessions = allSessions.concat(s);
          } catch (_) {}
        }
        // Sort by ts descending, cap at 100
        allSessions.sort((a,b) => (b.ts||0)-(a.ts||0));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(allSessions.slice(0,100)));
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

    // ------------------------------------------------------------------ 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  // Bind to available port
  const boundPort = await bindServer(server, port);
  const url = `http://localhost:${boundPort}`;

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

  // Update module-level state
  running = true;
  currentPort = boundPort;
  currentUrl = url;
  activeServer = server;

  // --------------------------------------------------------- Graceful shutdown
  function shutdown() {
    for (const w of activeWatchers) {
      try {
        w.close();
      } catch {
        // Already closed
      }
    }
    activeWatchers.length = 0;

    // Close all SSE connections
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // Already ended
      }
    }
    sseClients.clear();

    server.close(() => {
      running = false;
      currentPort = null;
      currentUrl = null;
      activeServer = null;
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
    clientCount: sseClients.size,
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
