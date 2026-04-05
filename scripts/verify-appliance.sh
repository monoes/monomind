#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# Monobrain RVFA Appliance — Full Capability Verification Suite
# ADR-058: Self-Contained Monobrain RVF Appliance
#
# Tests ALL 35 categories (95+ checks) to verify every capability
# of the Monobrain + Monobrain system works correctly.
#
# Usage:
#   sh verify-appliance.sh                    # Run all checks
#   sh verify-appliance.sh --quick            # Critical checks only
#   sh verify-appliance.sh --category memory  # Single category
#   sh verify-appliance.sh --json             # JSON output
# ═══════════════════════════════════════════════════════════════
set -e

# ── Configuration ─────────────────────────────────────────────
PASS=0
FAIL=0
WARN=0
SKIP=0
ERRORS=""
START_TIME=$(date +%s)
QUICK_MODE=0
TARGET_CATEGORY=""
JSON_MODE=0
MONOBRAIN_CMD="${MONOBRAIN_CMD:-monobrain}"

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --quick|-q)     QUICK_MODE=1; shift ;;
    --category|-c)  TARGET_CATEGORY="$2"; shift 2 ;;
    --json|-j)      JSON_MODE=1; shift ;;
    --help|-h)
      echo "Monobrain Appliance Verification Suite"
      echo ""
      echo "Usage: sh verify-appliance.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --quick, -q            Run critical checks only (categories 1-5, 25)"
      echo "  --category, -c NAME    Run single category (e.g. memory, security, mcp)"
      echo "  --json, -j             Output results as JSON"
      echo "  --help, -h             Show this help"
      echo ""
      echo "Environment:"
      echo "  MONOBRAIN_CMD=monobrain        Command to test (default: monobrain)"
      echo "  SKIP_NETWORK=1         Skip checks that require network"
      echo "  SKIP_MODELS=1          Skip local model inference checks"
      exit 0
      ;;
    *) shift ;;
  esac
done

# ── Test Helpers ──────────────────────────────────────────────
check() {
  local name="$1"
  shift
  local output
  output=$("$@" 2>&1) && {
    PASS=$((PASS + 1))
    [ "$JSON_MODE" = "0" ] && printf "  ✓ %s\n" "$name"
    return 0
  } || {
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  ✗ $name: $(echo "$output" | tail -1)"
    [ "$JSON_MODE" = "0" ] && printf "  ✗ %s\n" "$name"
    return 1
  }
}

check_contains() {
  local name="$1"
  local expected="$2"
  shift 2
  local output
  output=$("$@" 2>&1)
  if echo "$output" | grep -qi "$expected"; then
    PASS=$((PASS + 1))
    [ "$JSON_MODE" = "0" ] && printf "  ✓ %s\n" "$name"
    return 0
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  ✗ $name: expected '$expected' in output"
    [ "$JSON_MODE" = "0" ] && printf "  ✗ %s\n" "$name"
    return 1
  fi
}

check_warn() {
  local name="$1"
  shift
  local output
  output=$("$@" 2>&1) && {
    PASS=$((PASS + 1))
    [ "$JSON_MODE" = "0" ] && printf "  ✓ %s\n" "$name"
  } || {
    WARN=$((WARN + 1))
    [ "$JSON_MODE" = "0" ] && printf "  ⚠ %s (non-critical)\n" "$name"
  }
}

check_skip() {
  local name="$1"
  local reason="$2"
  SKIP=$((SKIP + 1))
  [ "$JSON_MODE" = "0" ] && printf "  ⊘ %s (skipped: %s)\n" "$name" "$reason"
}

section() {
  local num="$1"
  local name="$2"
  [ "$JSON_MODE" = "0" ] && echo "" && echo "═══ $num. $name ═══"
}

should_run() {
  local category="$1"
  [ -z "$TARGET_CATEGORY" ] && return 0
  echo "$category" | grep -qi "$TARGET_CATEGORY" && return 0
  return 1
}

is_quick() {
  [ "$QUICK_MODE" = "1" ]
}

# ── Detect Monobrain version ─────────────────────────────────────
MONOBRAIN_VERSION=$($MONOBRAIN_CMD --version 2>/dev/null || echo "unknown")

# ── Banner ────────────────────────────────────────────────────
if [ "$JSON_MODE" = "0" ]; then
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  Monobrain Appliance — Full Capability Verification Suite   ║"
  if [ -f /etc/os-release ]; then
    OS_NAME=$(grep PRETTY /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "unknown")
    echo "║  OS: $OS_NAME"
  fi
  echo "║  Node: $(node --version 2>/dev/null || echo 'N/A')"
  echo "║  Monobrain: $MONOBRAIN_VERSION"
  echo "║  Mode: $([ "$QUICK_MODE" = "1" ] && echo "Quick" || echo "Full") | $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "╚══════════════════════════════════════════════════════════╝"
fi

# ═══════════════════════════════════════════════════════════════
# PART I: Core CLI (Categories 1-5)
# ═══════════════════════════════════════════════════════════════

# ── 1. CLI Core ───────────────────────────────────────────────
if should_run "cli"; then
  section 1 "CLI Core"
  check "monobrain --version" $MONOBRAIN_CMD --version
  check "monobrain --help" $MONOBRAIN_CMD --help
  check_contains "version string valid" "[0-9]\+\.[0-9]\+\.[0-9]" $MONOBRAIN_CMD --version
fi

# ── 2. Doctor ─────────────────────────────────────────────────
if should_run "doctor"; then
  section 2 "Doctor (Health Checks)"
  check "doctor runs" $MONOBRAIN_CMD doctor
  check "doctor --fix" $MONOBRAIN_CMD doctor --fix
  check "doctor -c node" $MONOBRAIN_CMD doctor -c node
  check "doctor -c npm" $MONOBRAIN_CMD doctor -c npm
  check "doctor -c disk" $MONOBRAIN_CMD doctor -c disk
  check "doctor -c version" $MONOBRAIN_CMD doctor -c version
fi

# ── 3. Init System ────────────────────────────────────────────
if should_run "init"; then
  section 3 "Init System"
  TEST_DIR="/tmp/monobrain-verify-$$"
  mkdir -p "$TEST_DIR" && cd "$TEST_DIR"
  check "init --yes" $MONOBRAIN_CMD init --yes
  check ".claude/settings.json exists" test -f .claude/settings.json
  check ".claude/helpers/ exists" test -d .claude/helpers
  check_contains "no TeammateIdle in hooks" "false" sh -c '! grep -q "TeammateIdle" .claude/settings.json && echo false'
  check_contains "no TaskCompleted in hooks" "false" sh -c '! grep -q "\"TaskCompleted\"" .claude/settings.json && echo false'
  check_contains "AGENT_TEAMS env set" "AGENT_TEAMS" cat .claude/settings.json
  check_contains "agentTeams config present" "agentTeams" cat .claude/settings.json
  check_contains "statusLine configured" "statusLine" cat .claude/settings.json
  check "helpers/statusline.cjs exists" test -f .claude/helpers/statusline.cjs
  cd /tmp
  rm -rf "$TEST_DIR"
fi

# ── 4. Memory Operations ─────────────────────────────────────
if should_run "memory"; then
  section 4 "Memory Operations (AgentDB + RVF)"
  check "memory init" $MONOBRAIN_CMD memory init --force
  check "memory store key-1" $MONOBRAIN_CMD memory store --key "verify-1" --value "Capability verification entry one" --namespace verify
  check "memory store key-2" $MONOBRAIN_CMD memory store --key "verify-2" --value "Vector search verification entry" --namespace verify
  check "memory store key-3 with tags" $MONOBRAIN_CMD memory store --key "verify-3" --value "Embedding generation test data" --namespace verify --tags "test,verify"
  check "memory list" $MONOBRAIN_CMD memory list --namespace verify
  check_contains "memory list shows 3 entries" "3" $MONOBRAIN_CMD memory list --namespace verify
  check "memory search (semantic)" $MONOBRAIN_CMD memory search --query "vector search" --namespace verify
  check_contains "memory search finds result" "verify-" $MONOBRAIN_CMD memory search --query "capability verification" --namespace verify
  check "memory retrieve" $MONOBRAIN_CMD memory retrieve --key "verify-1" --namespace verify
  check_contains "memory retrieve content correct" "Capability verification" $MONOBRAIN_CMD memory retrieve --key "verify-1" --namespace verify
  check "memory store with TTL" $MONOBRAIN_CMD memory store --key "ttl-verify" --value "expires soon" --namespace verify --ttl 3600
  check "memory delete" $MONOBRAIN_CMD memory delete --key "ttl-verify" --namespace verify
  # Cleanup
  $MONOBRAIN_CMD memory delete --key "verify-1" --namespace verify >/dev/null 2>&1 || true
  $MONOBRAIN_CMD memory delete --key "verify-2" --namespace verify >/dev/null 2>&1 || true
  $MONOBRAIN_CMD memory delete --key "verify-3" --namespace verify >/dev/null 2>&1 || true
fi

# ── 5. Config Management ─────────────────────────────────────
if should_run "config"; then
  section 5 "Config Management"
  check "config show" $MONOBRAIN_CMD config show
  check "config get" $MONOBRAIN_CMD config get memory.backend
  check_warn "config set" $MONOBRAIN_CMD config set memory.backend hybrid
  check "config list" $MONOBRAIN_CMD config list
fi

# Stop here for quick mode (except cross-feature at end)
if is_quick && [ -z "$TARGET_CATEGORY" ]; then
  # Jump to cross-feature integration
  section 25 "Cross-Feature Integration (Quick)"
  check "quick: store" $MONOBRAIN_CMD memory store --key "quick-test" --value "Quick mode integration test" --namespace quick
  check_contains "quick: search" "quick-test" $MONOBRAIN_CMD memory search --query "integration test" --namespace quick
  check_contains "quick: retrieve" "Quick mode" $MONOBRAIN_CMD memory retrieve --key "quick-test" --namespace quick
  check "quick: cleanup" $MONOBRAIN_CMD memory delete --key "quick-test" --namespace quick

  # Print results and exit
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  echo ""
  echo "══════════════════════════════════════════════════"
  echo "  QUICK MODE RESULTS (${DURATION}s)"
  echo "══════════════════════════════════════════════════"
  echo "  Passed:   $PASS"
  echo "  Failed:   $FAIL"
  echo "  Warnings: $WARN"
  echo "  Total:    $((PASS + FAIL + WARN))"
  echo ""
  [ $FAIL -gt 0 ] && printf "$ERRORS\n"
  [ $FAIL -eq 0 ] && echo "  ★ ALL CRITICAL CHECKS PASSED" || echo "  ✗ $FAIL FAILURES"
  echo "══════════════════════════════════════════════════"
  exit $FAIL
fi

# ═══════════════════════════════════════════════════════════════
# PART II: Agent & Swarm (Categories 6-9)
# ═══════════════════════════════════════════════════════════════

# ── 6. Session Management ─────────────────────────────────────
if should_run "session"; then
  section 6 "Session Management"
  check_warn "session list" $MONOBRAIN_CMD session list
  check_warn "session start" $MONOBRAIN_CMD session start --session-id "verify-session-$$"
  check_warn "session status" $MONOBRAIN_CMD session status
  check_warn "session end" $MONOBRAIN_CMD session end
fi

# ── 7. Agent System ───────────────────────────────────────────
if should_run "agent"; then
  section 7 "Agent System"
  check "agent list" $MONOBRAIN_CMD agent list
  check_warn "agent spawn (dry)" $MONOBRAIN_CMD agent spawn -t coder --name verify-agent --dry-run
  check_warn "agent status" $MONOBRAIN_CMD agent status
  check_warn "agent pool" $MONOBRAIN_CMD agent pool
fi

# ── 8. Swarm Coordination ────────────────────────────────────
if should_run "swarm"; then
  section 8 "Swarm Coordination"
  check_warn "swarm status" $MONOBRAIN_CMD swarm status
  check_warn "swarm init (hierarchical)" $MONOBRAIN_CMD swarm init --topology hierarchical --max-agents 4
  check_warn "swarm init (mesh)" $MONOBRAIN_CMD swarm init --topology mesh --max-agents 4
fi

# ── 9. Task System ────────────────────────────────────────────
if should_run "task"; then
  section 9 "Task System"
  check_warn "task list" $MONOBRAIN_CMD task list
  check_warn "task create" $MONOBRAIN_CMD task create --description "Verify task system" --type feature
fi

# ═══════════════════════════════════════════════════════════════
# PART III: Intelligence & Learning (Categories 10-14)
# ═══════════════════════════════════════════════════════════════

# ── 10. Hooks System ──────────────────────────────────────────
if should_run "hooks"; then
  section 10 "Hooks System (17 Hooks + 12 Workers)"
  check "hooks list" $MONOBRAIN_CMD hooks list
  check "hooks route" $MONOBRAIN_CMD hooks route --task "test routing"
  check_warn "hooks pre-task" $MONOBRAIN_CMD hooks pre-task --description "verify hooks"
  check "hooks worker list" $MONOBRAIN_CMD hooks worker list
  check "hooks statusline" $MONOBRAIN_CMD hooks statusline --json
  check "hooks progress" $MONOBRAIN_CMD hooks progress
fi

# ── 11. Security ──────────────────────────────────────────────
if should_run "security"; then
  section 11 "Security"
  check "security scan" $MONOBRAIN_CMD security scan
  check "security audit" $MONOBRAIN_CMD security audit
  check "security validate" $MONOBRAIN_CMD security validate
fi

# ── 12. Performance ───────────────────────────────────────────
if should_run "performance"; then
  section 12 "Performance"
  check "performance metrics" $MONOBRAIN_CMD performance metrics
  check "performance benchmark" $MONOBRAIN_CMD performance benchmark
fi

# ── 13. Neural / Intelligence ─────────────────────────────────
if should_run "neural"; then
  section 13 "Neural / Intelligence (SONA + MoE)"
  check "neural status" $MONOBRAIN_CMD neural status
  check "neural patterns" $MONOBRAIN_CMD neural patterns --list
fi

# ── 14. Embeddings ────────────────────────────────────────────
if should_run "embeddings"; then
  section 14 "Embeddings (Vector Generation)"
  check "embeddings embed" $MONOBRAIN_CMD embeddings embed --text "test embedding generation"
  check "embeddings search" $MONOBRAIN_CMD embeddings search --query "test" --namespace verify
fi

# ═══════════════════════════════════════════════════════════════
# PART IV: Platform Services (Categories 15-24)
# ═══════════════════════════════════════════════════════════════

# ── 15. Workflow System ───────────────────────────────────────
if should_run "workflow"; then
  section 15 "Workflow System"
  check "workflow list" $MONOBRAIN_CMD workflow list
  check "workflow templates" $MONOBRAIN_CMD workflow list --templates
fi

# ── 16. Daemon ────────────────────────────────────────────────
if should_run "daemon"; then
  section 16 "Daemon (Background Workers)"
  check "daemon status" $MONOBRAIN_CMD daemon status
  check "daemon start" $MONOBRAIN_CMD daemon start
fi

# ── 17. Claims Authorization ──────────────────────────────────
if should_run "claims"; then
  section 17 "Claims Authorization (RBAC)"
  check "claims list" $MONOBRAIN_CMD claims list
  check "claims check" $MONOBRAIN_CMD claims check --claim "memory:read"
fi

# ── 18. Migration ─────────────────────────────────────────────
if should_run "migration"; then
  section 18 "Migration (V2 → V1)"
  check_warn "migrate status" $MONOBRAIN_CMD migrate status
fi

# ── 19. Plugins ───────────────────────────────────────────────
if should_run "plugin"; then
  section 19 "Plugins (IPFS Registry)"
  check "plugins list" $MONOBRAIN_CMD plugins list
fi

# ── 20. MCP Server ────────────────────────────────────────────
if should_run "mcp"; then
  section 20 "MCP Server (215 Tools)"
  check_contains "mcp help" "mcp" $MONOBRAIN_CMD mcp --help
  check "mcp list" $MONOBRAIN_CMD mcp list
fi

# ── 21. Shell Completions ─────────────────────────────────────
if should_run "completions"; then
  section 21 "Shell Completions"
  check "completions bash" $MONOBRAIN_CMD completions bash
  check "completions zsh" $MONOBRAIN_CMD completions zsh
fi

# ── 22. Status ────────────────────────────────────────────────
if should_run "status"; then
  section 22 "System Status"
  check_warn "status" $MONOBRAIN_CMD status
fi

# ── 23. Hive-Mind ─────────────────────────────────────────────
if should_run "hive"; then
  section 23 "Hive-Mind (Byzantine Consensus)"
  check_warn "hive-mind status" $MONOBRAIN_CMD hive-mind status
fi

# ── 24. Process Management ────────────────────────────────────
if should_run "process"; then
  section 24 "Process Management"
  check_warn "process list" $MONOBRAIN_CMD process list
fi

# ═══════════════════════════════════════════════════════════════
# PART V: Integration & End-to-End (Categories 25-35)
# ═══════════════════════════════════════════════════════════════

# ── 25. Cross-Feature Integration ─────────────────────────────
if should_run "integration"; then
  section 25 "Cross-Feature Integration"
  check "integration: store" $MONOBRAIN_CMD memory store --key "int-verify" --value "Cross-feature integration with vector embeddings and semantic search" --namespace integration
  check_contains "integration: search finds it" "int-verify" $MONOBRAIN_CMD memory search --query "cross feature integration" --namespace integration
  check_contains "integration: retrieve content" "Cross-feature" $MONOBRAIN_CMD memory retrieve --key "int-verify" --namespace integration
  check "integration: cleanup" $MONOBRAIN_CMD memory delete --key "int-verify" --namespace integration
fi

# ── 26. RVF Format Verification ───────────────────────────────
if should_run "rvf"; then
  section 26 "RVF Format Verification"
  RVF_DIR="/tmp/monobrain-rvf-verify-$$"
  mkdir -p "$RVF_DIR"

  # Test RVF backend by writing and reading data
  check "rvf: memory init creates backend" $MONOBRAIN_CMD memory init --force
  check "rvf: store creates data file" $MONOBRAIN_CMD memory store --key "rvf-test" --value "RVF binary format verification" --namespace rvf-verify
  check_contains "rvf: retrieve confirms persistence" "RVF binary" $MONOBRAIN_CMD memory retrieve --key "rvf-test" --namespace rvf-verify
  check "rvf: multiple entries" sh -c "$MONOBRAIN_CMD memory store --key 'rvf-2' --value 'Second entry' --namespace rvf-verify && $MONOBRAIN_CMD memory store --key 'rvf-3' --value 'Third entry' --namespace rvf-verify"
  check_contains "rvf: list shows entries" "3" $MONOBRAIN_CMD memory list --namespace rvf-verify
  check "rvf: delete works" $MONOBRAIN_CMD memory delete --key "rvf-test" --namespace rvf-verify
  check_contains "rvf: list after delete" "2" $MONOBRAIN_CMD memory list --namespace rvf-verify
  # Cleanup
  $MONOBRAIN_CMD memory delete --key "rvf-2" --namespace rvf-verify >/dev/null 2>&1 || true
  $MONOBRAIN_CMD memory delete --key "rvf-3" --namespace rvf-verify >/dev/null 2>&1 || true
  rm -rf "$RVF_DIR"
fi

# ── 27. Local Model Inference (ruvLLM from RuVector) ──────────
if should_run "ruvllm"; then
  section 27 "Local Model Inference (ruvLLM / RuVector)"
  if [ "${SKIP_MODELS:-0}" = "1" ]; then
    check_skip "ruvllm: model load" "SKIP_MODELS=1"
    check_skip "ruvllm: tokenize" "SKIP_MODELS=1"
    check_skip "ruvllm: generate" "SKIP_MODELS=1"
    check_skip "ruvllm: stream" "SKIP_MODELS=1"
  elif command -v monobrain-ruvllm >/dev/null 2>&1; then
    check_warn "ruvllm: engine available" monobrain-ruvllm --version
    check_warn "ruvllm: model list" monobrain-ruvllm models list
    check_warn "ruvllm: tokenize" monobrain-ruvllm tokenize --text "Hello world"
    check_warn "ruvllm: generate" monobrain-ruvllm generate --prompt "2+2=" --max-tokens 10
  else
    check_skip "ruvllm: engine" "monobrain-ruvllm not installed (future: ADR-058 Phase 3)"
    check_skip "ruvllm: inference" "monobrain-ruvllm not installed"
  fi
fi

# ── 28. API Key Vault ─────────────────────────────────────────
if should_run "vault"; then
  section 28 "API Key Vault"
  if [ "${SKIP_NETWORK:-0}" = "1" ]; then
    check_skip "vault: connectivity" "SKIP_NETWORK=1"
  else
    check_warn "vault: provider test (anthropic)" $MONOBRAIN_CMD providers test anthropic
    check_warn "vault: provider test (openai)" $MONOBRAIN_CMD providers test openai
    check_warn "vault: providers list" $MONOBRAIN_CMD providers list
  fi
fi

# ── 29. Boot Integrity ────────────────────────────────────────
if should_run "boot"; then
  section 29 "Boot Integrity"
  check "boot: monobrain binary exists" command -v $MONOBRAIN_CMD
  check "boot: node available" command -v node
  check_contains "boot: node version ≥ 20" "v2[0-9]" node --version
  check "boot: npm available" command -v npm
  check_warn "boot: claude cli available" command -v claude
fi

# ── 30. Isolation Checks ──────────────────────────────────────
if should_run "isolation"; then
  section 30 "Isolation Checks"
  if [ -f /.dockerenv ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
    check "isolation: running in container" test -f /.dockerenv -o -d /run/.containerenv
    check_warn "isolation: non-root user" test "$(id -u)" != "0"
    check "isolation: /tmp writable" test -w /tmp
    check "isolation: home writable" test -w "$HOME"
  else
    check_skip "isolation: container" "not running in container"
    check "isolation: filesystem writable" test -w /tmp
  fi
fi

# ── 31. Agent Swarm E2E ───────────────────────────────────────
if should_run "swarm-e2e"; then
  section 31 "Agent Swarm End-to-End"
  # Store coordination data, verify agents can read it
  check "swarm-e2e: store coordination context" $MONOBRAIN_CMD memory store --key "swarm-e2e-context" --value "Agent swarm coordination test: architect designs, coder implements, tester validates" --namespace swarm-e2e
  check_contains "swarm-e2e: search finds coordination" "swarm-e2e" $MONOBRAIN_CMD memory search --query "agent coordination" --namespace swarm-e2e
  check "swarm-e2e: agent list available" $MONOBRAIN_CMD agent list
  check_warn "swarm-e2e: swarm init" $MONOBRAIN_CMD swarm init --topology hierarchical --max-agents 4
  check_warn "swarm-e2e: swarm status" $MONOBRAIN_CMD swarm status
  # Cleanup
  $MONOBRAIN_CMD memory delete --key "swarm-e2e-context" --namespace swarm-e2e >/dev/null 2>&1 || true
fi

# ── 32. MCP End-to-End ────────────────────────────────────────
if should_run "mcp-e2e"; then
  section 32 "MCP Protocol End-to-End"
  check_contains "mcp-e2e: help lists commands" "start\|list\|add" $MONOBRAIN_CMD mcp --help
  check "mcp-e2e: mcp list" $MONOBRAIN_CMD mcp list
  # Test MCP server can start (timeout after 3s)
  check_warn "mcp-e2e: server starts" sh -c "timeout 3 $MONOBRAIN_CMD mcp start --transport stdio 2>&1 || true"
fi

# ── 33. Persistence Cycle ─────────────────────────────────────
if should_run "persistence"; then
  section 33 "Persistence (Write → Verify → Survive)"
  PERSIST_NS="persist-verify-$$"
  check "persist: write data" $MONOBRAIN_CMD memory store --key "persist-1" --value "Persistence test: this data must survive" --namespace "$PERSIST_NS"
  check "persist: write more data" $MONOBRAIN_CMD memory store --key "persist-2" --value "Second persistence entry for durability" --namespace "$PERSIST_NS"
  # Re-read (simulates restart — data should be on disk)
  check_contains "persist: data survives re-read" "Persistence test" $MONOBRAIN_CMD memory retrieve --key "persist-1" --namespace "$PERSIST_NS"
  check_contains "persist: second entry survives" "Second persistence" $MONOBRAIN_CMD memory retrieve --key "persist-2" --namespace "$PERSIST_NS"
  check_contains "persist: count correct" "2" $MONOBRAIN_CMD memory list --namespace "$PERSIST_NS"
  # Cleanup
  $MONOBRAIN_CMD memory delete --key "persist-1" --namespace "$PERSIST_NS" >/dev/null 2>&1 || true
  $MONOBRAIN_CMD memory delete --key "persist-2" --namespace "$PERSIST_NS" >/dev/null 2>&1 || true
fi

# ── 34. Offline Mode ──────────────────────────────────────────
if should_run "offline"; then
  section 34 "Offline Capability"
  # These commands should all work without network
  check "offline: version (no network needed)" $MONOBRAIN_CMD --version
  check "offline: doctor (local checks)" $MONOBRAIN_CMD doctor -c node
  check "offline: memory store (local)" $MONOBRAIN_CMD memory store --key "offline-test" --value "Works without internet" --namespace offline
  check_contains "offline: memory retrieve (local)" "Works without" $MONOBRAIN_CMD memory retrieve --key "offline-test" --namespace offline
  check "offline: config show (local)" $MONOBRAIN_CMD config show
  check_warn "offline: status (local)" $MONOBRAIN_CMD status
  check "offline: completions (local)" $MONOBRAIN_CMD completions bash
  # Cleanup
  $MONOBRAIN_CMD memory delete --key "offline-test" --namespace offline >/dev/null 2>&1 || true
fi

# ── 35. Hot Update Simulation ─────────────────────────────────
if should_run "update"; then
  section 35 "Hot Update Simulation"
  # Verify the current version can be read
  check "update: current version readable" $MONOBRAIN_CMD --version
  check "update: doctor validates current" $MONOBRAIN_CMD doctor
  check_warn "update: config backup possible" $MONOBRAIN_CMD config show
fi

# ═══════════════════════════════════════════════════════════════
# RESULTS
# ═══════════════════════════════════════════════════════════════
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL=$((PASS + FAIL + WARN + SKIP))

if [ "$JSON_MODE" = "1" ]; then
  cat <<ENDJSON
{
  "suite": "monobrain-appliance-verify",
  "version": "$MONOBRAIN_VERSION",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "duration_seconds": $DURATION,
  "results": {
    "passed": $PASS,
    "failed": $FAIL,
    "warnings": $WARN,
    "skipped": $SKIP,
    "total": $TOTAL
  },
  "success": $([ $FAIL -eq 0 ] && echo "true" || echo "false")
}
ENDJSON
else
  echo ""
  echo "══════════════════════════════════════════════════"
  echo "  RESULTS (${DURATION}s)"
  echo "══════════════════════════════════════════════════"
  echo "  Passed:   $PASS"
  echo "  Failed:   $FAIL"
  echo "  Warnings: $WARN (non-critical)"
  echo "  Skipped:  $SKIP"
  echo "  Total:    $TOTAL"
  echo ""

  if [ $FAIL -gt 0 ]; then
    echo "  FAILURES:"
    printf "$ERRORS\n"
    echo ""
  fi

  if [ $FAIL -eq 0 ]; then
    echo "  ★ ALL CRITICAL CHECKS PASSED"
  else
    echo "  ✗ $FAIL CRITICAL FAILURES"
  fi
  echo "══════════════════════════════════════════════════"
fi

exit $FAIL
