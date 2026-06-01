#!/usr/bin/env node
/**
 * Generates 120 unique SVG agent avatar files + a sprite-sheet HTML.
 * Output: packages/@monomind/cli/dist/src/ui/data/avatars/
 * Run: node scripts/generate-agent-avatars.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../packages/@monomind/cli/dist/src/ui/data/avatars');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Palettes ────────────────────────────────────────────────────────────────

const SKIN = ['#FDDBB4','#F5C18E','#E8A977','#C68642','#A0693A','#6B3F2A','#FFE0C8','#D4956A'];
const HAIR = ['#1a1208','#3B2314','#6B3A2A','#8B5E3C','#B8860B','#C0A060','#D4D4D4','#E84040','#5B5BCC','#2C2C2C'];
const EYES = ['#2a3a5c','#3B7DD8','#2E8B57','#8B4513','#5B2D8E','#1a5c4a'];

// Role category → background + body colors
const CAT_COLORS = {
  core:       { bg:'#EBF4FF', body:'#3B7DD8', accent:'#1a5bb5' },
  security:   { bg:'#FFF0F0', body:'#E63946', accent:'#b52835' },
  swarm:      { bg:'#F3EEFF', body:'#7B5EA7', accent:'#5B3E87' },
  consensus:  { bg:'#EEF9FF', body:'#2196A8', accent:'#16707A' },
  perf:       { bg:'#FFF6EE', body:'#F4A261', accent:'#D4824A' },
  github:     { bg:'#F0F2F5', body:'#2D3748', accent:'#1a212e' },
  sparc:      { bg:'#E8FAF5', body:'#2A9D8F', accent:'#1A7D72' },
  devops:     { bg:'#F0FFF4', body:'#38A169', accent:'#2D8656' },
  legal:      { bg:'#FFFBEC', body:'#8B6914', accent:'#6B4F10' },
  content:    { bg:'#FFF0F9', body:'#D63584', accent:'#A8266A' },
  product:    { bg:'#F0F9F0', body:'#2E8B57', accent:'#1E6B42' },
  sales:      { bg:'#FFF8F0', body:'#E67E22', accent:'#BF6010' },
  ai:         { bg:'#F0F0FF', body:'#5B5BCC', accent:'#3A3AAA' },
  creative:   { bg:'#FFF8E8', body:'#D4A017', accent:'#A87B10' },
  blockchain: { bg:'#F0FDF9', body:'#0D9488', accent:'#0A7A70' },
  management: { bg:'#F5F0FF', body:'#6D28D9', accent:'#5014B8' },
  frontend:   { bg:'#FFF0FB', body:'#C026D3', accent:'#9A1AAA' },
  data:       { bg:'#F0F9FF', body:'#0EA5E9', accent:'#0880C0' },
  infra:      { bg:'#F1FFF4', body:'#16A34A', accent:'#0F7F36' },
  testing:    { bg:'#FFFBF0', body:'#CA8A04', accent:'#A06800' },
};

// ─── Hair path generators (cx=60, head top ≈ y24, radius≈20) ─────────────────

function hairShort(col) {
  return `<ellipse cx="60" cy="22" rx="20" ry="10" fill="${col}"/>
  <rect x="40" y="22" width="40" height="8" rx="4" fill="${col}"/>`;
}
function hairMedium(col) {
  return `<ellipse cx="60" cy="21" rx="21" ry="12" fill="${col}"/>
  <rect x="39" y="21" width="10" height="22" rx="5" fill="${col}"/>
  <rect x="71" y="21" width="10" height="22" rx="5" fill="${col}"/>`;
}
function hairLong(col) {
  return `<ellipse cx="60" cy="20" rx="22" ry="13" fill="${col}"/>
  <rect x="37" y="20" width="11" height="42" rx="5" fill="${col}"/>
  <rect x="72" y="20" width="11" height="42" rx="5" fill="${col}"/>`;
}
function hairCurly(col) {
  return `<ellipse cx="60" cy="18" rx="24" ry="14" fill="${col}"/>
  <circle cx="38" cy="25" r="9" fill="${col}"/>
  <circle cx="82" cy="25" r="9" fill="${col}"/>
  <circle cx="48" cy="14" r="8" fill="${col}"/>
  <circle cx="72" cy="14" r="8" fill="${col}"/>
  <circle cx="60" cy="11" r="9" fill="${col}"/>`;
}
function hairMohawk(col) {
  return `<ellipse cx="60" cy="22" rx="18" ry="9" fill="${col}"/>
  <rect x="55" y="6" width="10" height="20" rx="5" fill="${col}"/>`;
}
function hairBun(col) {
  return `<ellipse cx="60" cy="24" rx="19" ry="8" fill="${col}"/>
  <circle cx="60" cy="14" r="10" fill="${col}"/>`;
}

const HAIR_FNS = [hairShort, hairMedium, hairLong, hairCurly, hairMohawk, hairBun];

// ─── Eye shapes ──────────────────────────────────────────────────────────────

function eyesRound(col) {
  return `<circle cx="51" cy="44" r="4.5" fill="white"/>
  <circle cx="69" cy="44" r="4.5" fill="white"/>
  <circle cx="51" cy="44" r="3" fill="${col}"/>
  <circle cx="69" cy="44" r="3" fill="${col}"/>
  <circle cx="52" cy="43" r="1.2" fill="white"/>
  <circle cx="70" cy="43" r="1.2" fill="white"/>`;
}
function eyesAlmond(col) {
  return `<path d="M45,44 Q51,39 57,44 Q51,49 45,44Z" fill="white"/>
  <path d="M63,44 Q69,39 75,44 Q69,49 63,44Z" fill="white"/>
  <circle cx="51" cy="44" r="2.8" fill="${col}"/>
  <circle cx="69" cy="44" r="2.8" fill="${col}"/>
  <circle cx="52" cy="43" r="1.1" fill="white"/>
  <circle cx="70" cy="43" r="1.1" fill="white"/>`;
}
function eyesWide(col) {
  return `<ellipse cx="51" cy="44" rx="5.5" ry="4" fill="white"/>
  <ellipse cx="69" cy="44" rx="5.5" ry="4" fill="white"/>
  <circle cx="51" cy="44" r="3" fill="${col}"/>
  <circle cx="69" cy="44" r="3" fill="${col}"/>
  <circle cx="52.5" cy="43" r="1.2" fill="white"/>
  <circle cx="70.5" cy="43" r="1.2" fill="white"/>`;
}
function eyesNarrow(col) {
  return `<ellipse cx="51" cy="44" rx="5" ry="2.5" fill="white"/>
  <ellipse cx="69" cy="44" rx="5" ry="2.5" fill="white"/>
  <circle cx="51" cy="44" r="2.2" fill="${col}"/>
  <circle cx="69" cy="44" r="2.2" fill="${col}"/>
  <circle cx="52" cy="43.2" r="1" fill="white"/>
  <circle cx="70" cy="43.2" r="1" fill="white"/>`;
}

const EYE_FNS = [eyesRound, eyesAlmond, eyesWide, eyesNarrow];

// ─── Accessories (role-specific icons drawn in SVG) ───────────────────────────

const ACCESSORIES = {
  glasses:     `<path d="M43,44 Q51,50 59,44" stroke="#555" stroke-width="2" fill="none"/>
  <path d="M61,44 Q69,50 77,44" stroke="#555" stroke-width="2" fill="none"/>
  <line x1="59" y1="44" x2="61" y2="44" stroke="#555" stroke-width="1.5"/>
  <line x1="43" y1="44" x2="41" y2="46" stroke="#555" stroke-width="1.5"/>
  <line x1="77" y1="44" x2="79" y2="46" stroke="#555" stroke-width="1.5"/>`,

  headset:     `<path d="M38,36 Q38,22 60,22 Q82,22 82,36" stroke="#444" stroke-width="3" fill="none"/>
  <rect x="33" y="34" width="9" height="12" rx="4" fill="#444"/>
  <rect x="78" y="34" width="9" height="12" rx="4" fill="#444"/>`,

  crown:       `<polygon points="48,24 60,14 72,24 76,22 72,30 48,30 44,22" fill="#D4A017"/>
  <circle cx="60" cy="14" r="3" fill="#E84040"/>`,

  visor:       `<ellipse cx="60" cy="22" rx="22" ry="6" fill="#3B7DD8" opacity="0.8"/>`,

  badge:       `<rect x="50" y="72" width="20" height="14" rx="3" fill="#D4A017"/>
  <text x="60" y="82" text-anchor="middle" font-size="7" font-family="monospace" fill="#1a1a1a" font-weight="bold">ID</text>`,

  earpiece:    `<circle cx="38" cy="44" r="4" fill="#555"/>
  <line x1="38" y1="48" x2="36" y2="60" stroke="#555" stroke-width="1.5"/>`,

  beanie:      `<ellipse cx="60" cy="24" rx="22" ry="6" fill="#5B5BCC"/>
  <rect x="38" y="22" width="44" height="10" rx="3" fill="#5B5BCC"/>
  <circle cx="60" cy="16" r="5" fill="#CC5B5B"/>`,

  goggles:     `<ellipse cx="50" cy="44" rx="8" ry="6" fill="none" stroke="#2a3a5c" stroke-width="2"/>
  <ellipse cx="70" cy="44" rx="8" ry="6" fill="none" stroke="#2a3a5c" stroke-width="2"/>
  <line x1="58" y1="44" x2="62" y2="44" stroke="#2a3a5c" stroke-width="2"/>
  <ellipse cx="50" cy="44" rx="6" ry="4" fill="#3B7DD820"/>
  <ellipse cx="70" cy="44" rx="6" ry="4" fill="#3B7DD820"/>`,

  headband:    `<rect x="38" y="28" width="44" height="7" rx="3" fill="#E63946"/>`,

  none:        ``,
};

// ─── Role icon badge (bottom-right corner of circle) ─────────────────────────

function roleIcon(symbol, color) {
  return `<circle cx="88" cy="88" r="16" fill="${color}" opacity="0.95"/>
  <text x="88" y="93" text-anchor="middle" font-size="14" fill="white" font-family="sans-serif">${symbol}</text>`;
}

// ─── Agent definitions ────────────────────────────────────────────────────────
// Each: { id, label, category, skinI, hairStyleI, hairColorI, eyeStyleI, eyeColorI, accessory, icon }
// Index values are seeded deterministically per agent.

const AGENTS = [
  // ── Core Development ──────────────────────────────────────────────────────
  { id:'coder',                label:'Coder',                 cat:'core',       icon:'💻', acc:'glasses' },
  { id:'senior-developer',     label:'Senior Developer',      cat:'core',       icon:'⚡', acc:'glasses' },
  { id:'reviewer',             label:'Code Reviewer',         cat:'core',       icon:'🔍', acc:'none' },
  { id:'tester',               label:'Tester',                cat:'core',       icon:'🧪', acc:'none' },
  { id:'planner',              label:'Planner',               cat:'core',       icon:'📋', acc:'none' },
  { id:'researcher',           label:'Researcher',            cat:'core',       icon:'📚', acc:'glasses' },
  // ── Security ──────────────────────────────────────────────────────────────
  { id:'security-architect',   label:'Security Architect',    cat:'security',   icon:'🛡️', acc:'none' },
  { id:'security-auditor',     label:'Security Auditor',      cat:'security',   icon:'🔒', acc:'headband' },
  { id:'threat-detection',     label:'Threat Detection',      cat:'security',   icon:'⚠️', acc:'goggles' },
  { id:'input-validator',      label:'Input Validator',       cat:'security',   icon:'✅', acc:'none' },
  { id:'path-validator',       label:'Path Validator',        cat:'security',   icon:'🗂️', acc:'none' },
  { id:'safe-executor',        label:'Safe Executor',         cat:'security',   icon:'🔐', acc:'none' },
  // ── Swarm ─────────────────────────────────────────────────────────────────
  { id:'hierarchical-coord',   label:'Hierarchical Coord.',   cat:'swarm',      icon:'🏛️', acc:'crown' },
  { id:'mesh-coordinator',     label:'Mesh Coordinator',      cat:'swarm',      icon:'🕸️', acc:'headset' },
  { id:'adaptive-coordinator', label:'Adaptive Coordinator',  cat:'swarm',      icon:'🔄', acc:'none' },
  { id:'collective-coord',     label:'Collective Intel.',      cat:'swarm',      icon:'🧠', acc:'none' },
  { id:'queen-coordinator',    label:'Queen Coordinator',     cat:'swarm',      icon:'👑', acc:'crown' },
  { id:'worker-specialist',    label:'Worker Specialist',     cat:'swarm',      icon:'⚙️', acc:'none' },
  // ── Consensus ─────────────────────────────────────────────────────────────
  { id:'byzantine-coord',      label:'Byzantine Coord.',      cat:'consensus',  icon:'⚖️', acc:'none' },
  { id:'raft-manager',         label:'Raft Manager',          cat:'consensus',  icon:'🚣', acc:'none' },
  { id:'gossip-coordinator',   label:'Gossip Coordinator',    cat:'consensus',  icon:'💬', acc:'none' },
  { id:'crdt-synchronizer',    label:'CRDT Synchronizer',     cat:'consensus',  icon:'🔗', acc:'none' },
  { id:'quorum-manager',       label:'Quorum Manager',        cat:'consensus',  icon:'🗳️', acc:'none' },
  { id:'consensus-coordinator',label:'Consensus Coord.',      cat:'consensus',  icon:'🤝', acc:'none' },
  // ── Performance ──────────────────────────────────────────────────────────
  { id:'perf-analyzer',        label:'Perf Analyzer',         cat:'perf',       icon:'📊', acc:'goggles' },
  { id:'benchmarker',          label:'Benchmarker',           cat:'perf',       icon:'⏱️', acc:'none' },
  { id:'task-orchestrator',    label:'Task Orchestrator',     cat:'perf',       icon:'🎯', acc:'headset' },
  { id:'memory-coordinator',   label:'Memory Coordinator',    cat:'perf',       icon:'🧮', acc:'none' },
  { id:'load-balancer',        label:'Load Balancer',         cat:'perf',       icon:'⚖️', acc:'none' },
  { id:'resource-allocator',   label:'Resource Allocator',    cat:'perf',       icon:'📦', acc:'none' },
  // ── GitHub / Repository ───────────────────────────────────────────────────
  { id:'pr-manager',           label:'PR Manager',            cat:'github',     icon:'🔀', acc:'none' },
  { id:'code-review-swarm',    label:'Code Review Swarm',     cat:'github',     icon:'👁️', acc:'glasses' },
  { id:'issue-tracker',        label:'Issue Tracker',         cat:'github',     icon:'🐛', acc:'none' },
  { id:'release-manager',      label:'Release Manager',       cat:'github',     icon:'🚀', acc:'none' },
  { id:'repo-architect',       label:'Repo Architect',        cat:'github',     icon:'🏗️', acc:'none' },
  { id:'workflow-automation',  label:'Workflow Automation',   cat:'github',     icon:'⚡', acc:'none' },
  // ── SPARC ─────────────────────────────────────────────────────────────────
  { id:'sparc-coord',          label:'SPARC Coordinator',     cat:'sparc',      icon:'⚡', acc:'crown' },
  { id:'sparc-coder',          label:'SPARC Coder',           cat:'sparc',      icon:'💡', acc:'glasses' },
  { id:'specification',        label:'Specification',         cat:'sparc',      icon:'📝', acc:'none' },
  { id:'pseudocode',           label:'Pseudocode',            cat:'sparc',      icon:'🔤', acc:'none' },
  { id:'architecture',         label:'Architecture',          cat:'sparc',      icon:'📐', acc:'none' },
  { id:'refinement',           label:'Refinement',            cat:'sparc',      icon:'✨', acc:'none' },
  // ── Specialized Dev ───────────────────────────────────────────────────────
  { id:'backend-dev',          label:'Backend Dev',           cat:'core',       icon:'🗄️', acc:'none' },
  { id:'frontend-developer',   label:'Frontend Developer',    cat:'frontend',   icon:'🎨', acc:'none' },
  { id:'mobile-dev',           label:'Mobile Developer',      cat:'frontend',   icon:'📱', acc:'none' },
  { id:'ml-developer',         label:'ML Developer',          cat:'ai',         icon:'🤖', acc:'goggles' },
  { id:'cicd-engineer',        label:'CI/CD Engineer',        cat:'devops',     icon:'🔄', acc:'none' },
  { id:'system-architect',     label:'System Architect',      cat:'core',       icon:'🏛️', acc:'none' },
  // ── AI / Data ─────────────────────────────────────────────────────────────
  { id:'ai-engineer',          label:'AI Engineer',           cat:'ai',         icon:'🧠', acc:'goggles' },
  { id:'model-qa',             label:'Model QA Specialist',   cat:'ai',         icon:'🔬', acc:'glasses' },
  { id:'data-engineer',        label:'Data Engineer',         cat:'data',       icon:'🗃️', acc:'none' },
  { id:'analytics-reporter',   label:'Analytics Reporter',    cat:'data',       icon:'📈', acc:'none' },
  { id:'experiment-tracker',   label:'Experiment Tracker',    cat:'ai',         icon:'🧫', acc:'none' },
  { id:'data-consolidator',    label:'Data Consolidator',     cat:'data',       icon:'🔧', acc:'none' },
  // ── DevOps / Infra ────────────────────────────────────────────────────────
  { id:'devops-automator',     label:'DevOps Automator',      cat:'devops',     icon:'⚙️', acc:'headset' },
  { id:'sre',                  label:'SRE',                   cat:'devops',     icon:'🔭', acc:'none' },
  { id:'incident-commander',   label:'Incident Commander',    cat:'devops',     icon:'🚨', acc:'headset' },
  { id:'infrastructure',       label:'Infrastructure',        cat:'infra',      icon:'🏗️', acc:'none' },
  { id:'database-optimizer',   label:'Database Optimizer',    cat:'infra',      icon:'🗄️', acc:'glasses' },
  { id:'cloud-architect',      label:'Cloud Architect',       cat:'infra',      icon:'☁️', acc:'none' },
  // ── Legal / Trial ─────────────────────────────────────────────────────────
  { id:'prosecutor',           label:'Prosecutor',            cat:'legal',      icon:'⚡', acc:'none' },
  { id:'defender',             label:'Defender',              cat:'legal',      icon:'🛡️', acc:'none' },
  { id:'judge',                label:'Judge',                 cat:'legal',      icon:'⚖️', acc:'crown' },
  { id:'case-analyst',         label:'Case Analyst',          cat:'legal',      icon:'📂', acc:'glasses' },
  { id:'trial-director',       label:'Trial Director',        cat:'legal',      icon:'🎬', acc:'crown' },
  { id:'legal-compliance',     label:'Legal Compliance',      cat:'legal',      icon:'📜', acc:'none' },
  // ── Content / Marketing ───────────────────────────────────────────────────
  { id:'technical-writer',     label:'Technical Writer',      cat:'content',    icon:'✍️', acc:'glasses' },
  { id:'content-creator',      label:'Content Creator',       cat:'content',    icon:'🎭', acc:'none' },
  { id:'seo-specialist',       label:'SEO Specialist',        cat:'content',    icon:'🔎', acc:'none' },
  { id:'social-media',         label:'Social Media',          cat:'content',    icon:'📣', acc:'none' },
  { id:'email-marketing',      label:'Email Marketing',       cat:'content',    icon:'📧', acc:'none' },
  { id:'ai-citation',          label:'AI Citation',           cat:'content',    icon:'🔗', acc:'glasses' },
  // ── Product ───────────────────────────────────────────────────────────────
  { id:'product-manager',      label:'Product Manager',       cat:'product',    icon:'🗺️', acc:'none' },
  { id:'sprint-prioritizer',   label:'Sprint Prioritizer',    cat:'product',    icon:'🎯', acc:'none' },
  { id:'launch-strategist',    label:'Launch Strategist',     cat:'product',    icon:'🚀', acc:'none' },
  { id:'pricing-strategist',   label:'Pricing Strategist',    cat:'product',    icon:'💰', acc:'none' },
  { id:'feedback-synthesizer', label:'Feedback Synthesizer',  cat:'product',    icon:'📥', acc:'none' },
  { id:'cro-specialist',       label:'CRO Specialist',        cat:'product',    icon:'📊', acc:'glasses' },
  // ── Sales ─────────────────────────────────────────────────────────────────
  { id:'sales-engineer',       label:'Sales Engineer',        cat:'sales',      icon:'🤝', acc:'badge' },
  { id:'deal-strategist',      label:'Deal Strategist',       cat:'sales',      icon:'♟️', acc:'none' },
  { id:'account-strategist',   label:'Account Strategist',    cat:'sales',      icon:'📊', acc:'badge' },
  { id:'outbound-strategist',  label:'Outbound Strategist',   cat:'sales',      icon:'📡', acc:'headset' },
  { id:'pipeline-analyst',     label:'Pipeline Analyst',      cat:'sales',      icon:'📉', acc:'none' },
  { id:'sales-coach',          label:'Sales Coach',           cat:'sales',      icon:'🏋️', acc:'none' },
  // ── Support / Success ─────────────────────────────────────────────────────
  { id:'support-responder',    label:'Support Responder',     cat:'content',    icon:'💬', acc:'headset' },
  { id:'discovery-coach',      label:'Discovery Coach',       cat:'sales',      icon:'🔭', acc:'none' },
  { id:'proposal-strategist',  label:'Proposal Strategist',   cat:'sales',      icon:'📋', acc:'none' },
  // ── Creative / Game ───────────────────────────────────────────────────────
  { id:'game-designer',        label:'Game Designer',         cat:'creative',   icon:'🎮', acc:'none' },
  { id:'narrative-designer',   label:'Narrative Designer',    cat:'creative',   icon:'📖', acc:'none' },
  { id:'level-designer',       label:'Level Designer',        cat:'creative',   icon:'🗺️', acc:'none' },
  { id:'game-audio-engineer',  label:'Game Audio Engineer',   cat:'creative',   icon:'🎵', acc:'headset' },
  { id:'technical-artist',     label:'Technical Artist',      cat:'creative',   icon:'🎨', acc:'none' },
  { id:'unity-architect',      label:'Unity Architect',       cat:'creative',   icon:'🕹️', acc:'none' },
  // ── Blockchain ────────────────────────────────────────────────────────────
  { id:'blockchain-auditor',   label:'Blockchain Auditor',    cat:'blockchain', icon:'⛓️', acc:'none' },
  { id:'solidity-engineer',    label:'Solidity Engineer',     cat:'blockchain', icon:'💎', acc:'glasses' },
  { id:'zk-steward',           label:'ZK Steward',            cat:'blockchain', icon:'🔏', acc:'none' },
  // ── Management ────────────────────────────────────────────────────────────
  { id:'studio-producer',      label:'Studio Producer',       cat:'management', icon:'🎬', acc:'crown' },
  { id:'project-shepherd',     label:'Project Shepherd',      cat:'management', icon:'🐑', acc:'none' },
  { id:'senior-pm',            label:'Senior PM',             cat:'management', icon:'📌', acc:'none' },
  { id:'studio-operations',    label:'Studio Operations',     cat:'management', icon:'🏢', acc:'none' },
  { id:'workflow-architect',   label:'Workflow Architect',    cat:'management', icon:'🌐', acc:'none' },
  { id:'adaptive-coordinator2',label:'Adaptive Coord. II',    cat:'management', icon:'♻️', acc:'headband' },
  // ── Testing / QA ─────────────────────────────────────────────────────────
  { id:'api-tester',           label:'API Tester',            cat:'testing',    icon:'🔌', acc:'none' },
  { id:'evidence-collector',   label:'Evidence Collector',    cat:'testing',    icon:'📸', acc:'goggles' },
  { id:'reality-checker',      label:'Reality Checker',       cat:'testing',    icon:'🔍', acc:'glasses' },
  { id:'production-validator', label:'Production Validator',  cat:'testing',    icon:'✅', acc:'none' },
  // ── Finance / HR ──────────────────────────────────────────────────────────
  { id:'finance-tracker',      label:'Finance Tracker',       cat:'sales',      icon:'💹', acc:'none' },
  { id:'accounts-payable',     label:'Accounts Payable',      cat:'sales',      icon:'💳', acc:'none' },
  { id:'recruitment',          label:'Recruitment',           cat:'management', icon:'🎯', acc:'none' },
  // ── Emerging Tech ─────────────────────────────────────────────────────────
  { id:'visionos-engineer',    label:'visionOS Engineer',     cat:'frontend',   icon:'👓', acc:'goggles' },
  { id:'embedded-firmware',    label:'Embedded Firmware',     cat:'infra',      icon:'🔌', acc:'goggles' },
  { id:'ios-developer',        label:'iOS Developer',         cat:'frontend',   icon:'📱', acc:'none' },
  { id:'mobile-app-builder',   label:'Mobile App Builder',    cat:'frontend',   icon:'🏗️', acc:'none' },
  { id:'mcp-builder',          label:'MCP Builder',           cat:'core',       icon:'🔧', acc:'none' },
  { id:'automation-governance',label:'Automation Governance', cat:'devops',     icon:'🏛️', acc:'none' },
  { id:'payment-agent',        label:'Payment Agent',         cat:'blockchain', icon:'💸', acc:'none' },
  { id:'compliance-auditor',   label:'Compliance Auditor',    cat:'security',   icon:'📋', acc:'glasses' },
  { id:'trend-researcher',     label:'Trend Researcher',      cat:'ai',         icon:'📡', acc:'none' },
  { id:'scout-explorer',       label:'Scout Explorer',        cat:'swarm',      icon:'🧭', acc:'visor' },
];

// Pad or trim to exactly 120
while (AGENTS.length < 120) {
  const a = AGENTS[AGENTS.length % AGENTS.length];
  AGENTS.push({ ...a, id: a.id + '-v' + AGENTS.length, label: a.label + ' II' });
}
const AGENTS120 = AGENTS.slice(0, 120);

// ─── Deterministic pseudo-random seeded by index ──────────────────────────────

function seeded(i, n) { return ((i * 2654435761) >>> 0) % n; }

// ─── SVG generation ──────────────────────────────────────────────────────────

function buildSVG(agent, i) {
  const cat   = CAT_COLORS[agent.cat] || CAT_COLORS.core;
  const skinI = seeded(i * 7 + 1, SKIN.length);
  const hairColorI = seeded(i * 13 + 3, HAIR.length);
  const hairStyleI = seeded(i * 11 + 5, HAIR_FNS.length);
  const eyeStyleI  = seeded(i * 17 + 7, EYE_FNS.length);
  const eyeColorI  = seeded(i * 19 + 9, EYES.length);

  const skinCol  = SKIN[skinI];
  const hairCol  = HAIR[hairColorI];
  const eyeCol   = EYES[eyeColorI];
  const hairSVG  = HAIR_FNS[hairStyleI](hairCol);
  const eyesSVG  = EYE_FNS[eyeStyleI](eyeCol);
  const accSVG   = ACCESSORIES[agent.acc] || ACCESSORIES.none;

  // Nose (tiny bump between eyes and mouth)
  const noseSVG = `<ellipse cx="60" cy="52" rx="2.5" ry="1.8" fill="${skinCol}" opacity="0.7" stroke="${skinCol}" stroke-width="0.5"/>`;

  // Mouth variant based on index
  const mouthType = seeded(i * 23, 3);
  const mouthSVG = mouthType === 0
    ? `<path d="M52,60 Q60,66 68,60" stroke="#C4726A" stroke-width="2" fill="none" stroke-linecap="round"/>`
    : mouthType === 1
    ? `<path d="M53,61 Q60,65 67,61" stroke="#C4726A" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    : `<path d="M54,60 L66,60" stroke="#C4726A" stroke-width="2" stroke-linecap="round"/>`;

  // Cheek blush (optional)
  const blush = seeded(i * 29, 3) === 0
    ? `<ellipse cx="46" cy="52" rx="5" ry="3" fill="#ff9999" opacity="0.3"/>
       <ellipse cx="74" cy="52" rx="5" ry="3" fill="#ff9999" opacity="0.3"/>`
    : '';

  // Body/torso
  const bodyH = 36;
  const bodySVG = `
  <!-- body -->
  <ellipse cx="60" cy="${94 + bodyH/2}" rx="26" ry="${bodyH}" fill="${cat.body}"/>
  <ellipse cx="60" cy="${94 + bodyH/2 - 2}" rx="22" ry="${bodyH - 4}" fill="${cat.accent}"/>
  <!-- collar -->
  <path d="M44,96 Q60,108 76,96" fill="${cat.bg}"/>
  <!-- neck -->
  <rect x="54" y="70" width="12" height="10" rx="4" fill="${skinCol}"/>
  `;

  // Ear highlights (simple circles on sides of head)
  const earsSVG = `
  <circle cx="38" cy="46" r="5" fill="${skinCol}"/>
  <circle cx="38" cy="46" r="3" fill="${skinCol}" opacity="0.5"/>
  <circle cx="82" cy="46" r="5" fill="${skinCol}"/>
  <circle cx="82" cy="46" r="3" fill="${skinCol}" opacity="0.5"/>
  `;

  // Badge icon (bottom right)
  const iconSVG = roleIcon(agent.icon, cat.body);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <clipPath id="circ">
      <circle cx="60" cy="60" r="58"/>
    </clipPath>
    <clipPath id="headClip">
      <ellipse cx="60" cy="42" rx="24" ry="28"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <circle cx="60" cy="60" r="58" fill="${cat.bg}"/>
  <circle cx="60" cy="60" r="58" fill="none" stroke="${cat.body}" stroke-width="3"/>

  <g clip-path="url(#circ)">
    ${bodySVG}
    <!-- head base -->
    <ellipse cx="60" cy="44" rx="22" ry="26" fill="${skinCol}"/>
    ${earsSVG}
    <!-- hair -->
    ${hairSVG}
    <!-- face features -->
    ${eyesSVG}
    ${noseSVG}
    ${mouthSVG}
    ${blush}
    <!-- accessory -->
    ${accSVG}
  </g>

  <!-- role badge -->
  ${iconSVG}
</svg>`;
}

// ─── Write individual SVGs ────────────────────────────────────────────────────

let written = 0;
AGENTS120.forEach((agent, i) => {
  const svg = buildSVG(agent, i);
  const filePath = path.join(OUT_DIR, `${agent.id}.svg`);
  fs.writeFileSync(filePath, svg, 'utf8');
  written++;
});

console.log(`✅ Written ${written} SVG avatars to: ${OUT_DIR}`);

// ─── Write manifest JSON ──────────────────────────────────────────────────────

const manifest = AGENTS120.map((a, i) => ({
  id:       a.id,
  label:    a.label,
  category: a.cat,
  icon:     a.icon,
  file:     `avatars/${a.id}.svg`,
  index:    i,
}));

fs.writeFileSync(
  path.join(OUT_DIR, '../agent-avatars.json'),
  JSON.stringify({ version: 1, count: manifest.length, agents: manifest }, null, 2),
  'utf8'
);
console.log(`✅ Manifest written: data/agent-avatars.json`);

// ─── Write sprite-sheet HTML viewer ──────────────────────────────────────────

const spriteHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Agent Avatars — 120 Characters</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1117; color: #e2e8f0; font-family: system-ui, sans-serif; padding: 32px; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; }
  .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 32px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 16px; }
  .card { display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; }
  .card img { width: 80px; height: 80px; border-radius: 50%; transition: transform 0.2s; }
  .card:hover img { transform: scale(1.15); }
  .card span { font-size: 0.62rem; color: #94a3b8; text-align: center; line-height: 1.3; max-width: 90px; }
  .cat-badge { font-size: 0.5rem; background: #1e293b; border-radius: 4px; padding: 1px 4px; color: #64748b; }
  input[type=search] { background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0;
    padding: 8px 14px; width: 280px; font-size: 0.875rem; margin-bottom: 24px; outline: none; }
  input[type=search]:focus { border-color: #3B7DD8; }
</style>
</head>
<body>
<h1>Agent Avatars</h1>
<p class="subtitle">120 unique character SVGs — transparent background, scale-free</p>
<input type="search" placeholder="Search agents…" oninput="filter(this.value)" id="q"/>
<div class="grid" id="grid">
${AGENTS120.map(a => `  <div class="card" data-label="${a.label.toLowerCase()}" data-cat="${a.cat}"
    onclick="copy('${a.id}')">
    <img src="avatars/${a.id}.svg" alt="${a.label}" loading="lazy"/>
    <span>${a.label}</span>
    <span class="cat-badge">${a.cat}</span>
  </div>`).join('\n')}
</div>
<script>
function filter(q) {
  q = q.toLowerCase();
  document.querySelectorAll('.card').forEach(c => {
    c.style.display = (c.dataset.label.includes(q) || c.dataset.cat.includes(q)) ? '' : 'none';
  });
}
function copy(id) {
  navigator.clipboard?.writeText('avatars/' + id + '.svg').catch(()=>{});
  const el = event.currentTarget.querySelector('img');
  el.style.outline = '3px solid #3B7DD8';
  setTimeout(() => el.style.outline = '', 1200);
}
</script>
</body>
</html>`;

const spritePath = path.join(OUT_DIR, '../agent-avatars.html');
fs.writeFileSync(spritePath, spriteHtml, 'utf8');
console.log(`✅ Sprite-sheet viewer: data/agent-avatars.html`);
console.log(`\n🎉 Done! ${AGENTS120.length} avatars ready.`);
console.log(`   Open: packages/@monomind/cli/dist/src/ui/data/agent-avatars.html`);
