#!/bin/bash
# Setup MCP server for Monobrain

echo "🚀 Setting up Monobrain MCP server..."

# Check if claude command exists
if ! command -v claude &> /dev/null; then
    echo "❌ Error: Claude Code CLI not found"
    echo "Please install Claude Code first"
    exit 1
fi

# Add MCP server
echo "📦 Adding Monobrain MCP server..."
claude mcp add monobrain npx monobrain mcp start

echo "✅ MCP server setup complete!"
echo "🎯 You can now use mcp__monobrain__ tools in Claude Code"
