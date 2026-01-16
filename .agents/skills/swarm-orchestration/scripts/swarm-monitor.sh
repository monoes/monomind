#!/bin/bash
# Swarm Orchestration - Monitor Script
# Real-time swarm monitoring

set -e

echo "Starting swarm monitor..."
npx @monobrain/cli swarm status --watch --interval 5
