#!/bin/bash
# Memory Management - Consolidate Script
# Optimize and consolidate memory

set -e

echo "Running memory consolidation..."
npx @monobrain/cli hooks worker dispatch --trigger consolidate

echo "Memory consolidation complete"
npx @monobrain/cli memory stats
