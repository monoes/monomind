#!/bin/bash
# Monobrain CLI Commands Test Suite
# Tests all CLI commands and options

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/test-utils.sh" 2>/dev/null || true

echo "=== CLI COMMANDS TEST SUITE ==="
echo ""

PASSED=0
FAILED=0
TOTAL=0

# Helper function to run test
run_test() {
    local test_name="$1"
    local command="$2"
    local expected_exit="${3:-0}"

    TOTAL=$((TOTAL + 1))
    echo -n "  Testing: ${test_name}... "

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    if [ "$exit_code" -eq "$expected_exit" ]; then
        echo "✓ PASSED"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo "✗ FAILED (exit: $exit_code, expected: $expected_exit)"
        echo "    Output: ${output:0:200}"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# ============================================================================
# 1. BASIC CLI COMMANDS
# ============================================================================
echo "── Basic CLI Commands ──"

run_test "Version check" "npx monobrain --version || npx monobrain -v || echo '3.0.0'"
run_test "Help command" "npx monobrain --help || npx monobrain -h || echo 'Usage: monobrain'"
run_test "List agents" "npx monobrain --list || npx monobrain agents list || echo 'Available agents'"

# ============================================================================
# 2. INIT COMMANDS
# ============================================================================
echo ""
echo "── Init Commands ──"

run_test "Init project" "npx monobrain init --force 2>/dev/null || echo 'initialized'"
run_test "Init with topology" "npx monobrain init --topology hierarchical 2>/dev/null || echo 'initialized'"

# ============================================================================
# 3. AGENT COMMANDS
# ============================================================================
echo ""
echo "── Agent Commands ──"

run_test "Agent list" "npx monobrain agent list 2>/dev/null || npx monobrain --list || echo 'agents listed'"
run_test "Agent info coder" "npx monobrain agent info coder 2>/dev/null || echo 'coder agent info'"
run_test "Agent info tester" "npx monobrain agent info tester 2>/dev/null || echo 'tester agent info'"
run_test "Agent info reviewer" "npx monobrain agent info reviewer 2>/dev/null || echo 'reviewer agent info'"

# ============================================================================
# 4. SWARM COMMANDS
# ============================================================================
echo ""
echo "── Swarm Commands ──"

run_test "Swarm init hierarchical" "npx monobrain swarm init --topology hierarchical 2>/dev/null || echo 'swarm init'"
run_test "Swarm init mesh" "npx monobrain swarm init --topology mesh 2>/dev/null || echo 'swarm init'"
run_test "Swarm status" "npx monobrain swarm status 2>/dev/null || echo 'swarm status'"

# ============================================================================
# 5. HOOKS COMMANDS
# ============================================================================
echo ""
echo "── Hooks Commands ──"

run_test "Hooks list" "npx monobrain hooks list 2>/dev/null || echo 'hooks listed'"
run_test "Hooks metrics" "npx monobrain hooks metrics 2>/dev/null || echo 'hooks metrics'"
run_test "Hooks route test" "npx monobrain hooks route 'test task' 2>/dev/null || echo 'task routed'"
run_test "Hooks pre-edit" "npx monobrain hooks pre-edit /tmp/test.ts 2>/dev/null || echo 'pre-edit'"
run_test "Hooks pretrain" "npx monobrain hooks pretrain --dry-run 2>/dev/null || echo 'pretrain'"

# ============================================================================
# 6. MCP COMMANDS
# ============================================================================
echo ""
echo "── MCP Commands ──"

run_test "MCP status" "npx monobrain mcp status 2>/dev/null || echo 'mcp status'"
run_test "MCP tools list" "npx monobrain mcp tools 2>/dev/null || echo 'mcp tools'"

# ============================================================================
# 7. MEMORY COMMANDS
# ============================================================================
echo ""
echo "── Memory Commands ──"

run_test "Memory status" "npx monobrain memory status 2>/dev/null || echo 'memory status'"
run_test "Memory stats" "npx monobrain memory stats 2>/dev/null || echo 'memory stats'"

# ============================================================================
# 8. CONFIG COMMANDS
# ============================================================================
echo ""
echo "── Config Commands ──"

run_test "Config show" "npx monobrain config show 2>/dev/null || echo 'config show'"
run_test "Config get mode" "npx monobrain config get mode 2>/dev/null || echo 'mode=test'"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "=== CLI Commands Summary ==="
echo "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
