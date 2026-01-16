# Monobrain V1 Statusline Hook
# Add to your shell RC file (.bashrc, .zshrc, etc.)

# Function to get statusline
monobrain_statusline() {
  local statusline_script="${MONOBRAIN_DIR:-.claude}/helpers/statusline.cjs"
  if [ -f "$statusline_script" ]; then
    node "$statusline_script" 2>/dev/null || echo ""
  fi
}

# For bash PS1
# export PS1='$(monobrain_statusline) \n\$ '

# For zsh RPROMPT
# export RPROMPT='$(monobrain_statusline)'

# For starship (add to starship.toml)
# [custom.monobrain]
# command = "node .claude/helpers/statusline.cjs 2>/dev/null"
# when = "test -f .claude/helpers/statusline.cjs"
