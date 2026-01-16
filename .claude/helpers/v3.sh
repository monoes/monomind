#!/bin/bash
# v1 Helper Alias Script - Quick access to all v1 development tools

set -e

HELPERS_DIR=".claude/helpers"

case "$1" in
  "status"|"st")
    "$HELPERS_DIR/v1-quick-status.sh"
    ;;

  "progress"|"prog")
    shift
    "$HELPERS_DIR/update-v1-progress.sh" "$@"
    ;;

  "validate"|"check")
    "$HELPERS_DIR/validate-v1-config.sh"
    ;;

  "statusline"|"sl")
    ".claude/statusline.sh"
    ;;

  "update")
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "Usage: v1 update <metric> <value>"
      echo "Examples:"
      echo "  v1 update domain 3"
      echo "  v1 update agent 8"
      echo "  v1 update security 2"
      echo "  v1 update performance 2.5x"
      echo "  v1 update memory 45%"
      echo "  v1 update ddd 75"
      exit 1
    fi
    "$HELPERS_DIR/update-v1-progress.sh" "$2" "$3"
    ;;

  "full-status"|"fs")
    echo "🔍 v1 Development Environment Status"
    echo "====================================="
    echo ""
    echo "📊 Quick Status:"
    "$HELPERS_DIR/v1-quick-status.sh"
    echo ""
    echo "📺 Full Statusline:"
    ".claude/statusline.sh"
    ;;

  "init")
    echo "🚀 Initializing v1 Development Environment..."

    # Run validation first
    echo ""
    echo "1️⃣ Validating configuration..."
    if "$HELPERS_DIR/validate-v1-config.sh"; then
      echo ""
      echo "2️⃣ Showing current status..."
      "$HELPERS_DIR/v1-quick-status.sh"
      echo ""
      echo "✅ v1 development environment is ready!"
      echo ""
      echo "🔧 Quick commands:"
      echo "  v1 status        - Show quick status"
      echo "  v1 update        - Update progress metrics"
      echo "  v1 statusline    - Show full statusline"
      echo "  v1 validate      - Validate configuration"
    else
      echo ""
      echo "❌ Configuration validation failed. Please fix issues before proceeding."
      exit 1
    fi
    ;;

  "help"|"--help"|"-h"|"")
    echo "MonoBrain v1 Helper Tool"
    echo "=========================="
    echo ""
    echo "Usage: v1 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  status, st              Show quick development status"
    echo "  progress, prog [args]   Update progress metrics"
    echo "  validate, check         Validate v1 configuration"
    echo "  statusline, sl          Show full statusline"
    echo "  full-status, fs         Show both quick status and statusline"
    echo "  update <metric> <value> Update specific metric"
    echo "  init                    Initialize and validate environment"
    echo "  help                    Show this help message"
    echo ""
    echo "Update Examples:"
    echo "  v1 update domain 3      # Mark 3 domains complete"
    echo "  v1 update agent 8       # Set 8 agents active"
    echo "  v1 update security 2    # Mark 2 CVEs fixed"
    echo "  v1 update performance 2.5x # Set performance to 2.5x"
    echo "  v1 update memory 45%    # Set memory reduction to 45%"
    echo "  v1 update ddd 75        # Set DDD progress to 75%"
    echo ""
    echo "Quick Start:"
    echo "  v1 init                 # Initialize environment"
    echo "  v1 status               # Check current progress"
    ;;

  *)
    echo "Unknown command: $1"
    echo "Run 'v1 help' for usage information"
    exit 1
    ;;
esac