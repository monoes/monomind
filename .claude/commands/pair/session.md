# Pair Programming Session Management

Complete guide to managing pair programming sessions.

## Session Lifecycle

### 1. Initialization
```bash
monobrain pair --start
```

### 2. Active Session
- Real-time collaboration
- Continuous verification
- Quality monitoring
- Role management

### 3. Completion
```bash
monobrain pair --end
```

## Session Commands

During an active session, use these commands:

### Basic Commands
```
/help          - Show all available commands
/status        - Current session status
/metrics       - View quality metrics
/pause         - Pause current session
/resume        - Resume paused session
/end           - End current session
```

### Code Commands
```
/explain       - Explain current code
/suggest       - Get improvement suggestions
/refactor      - Refactor selected code
/optimize      - Optimize for performance
/document      - Add documentation
/comment       - Add inline comments
```

### Testing Commands
```
/test          - Run test suite
/test-gen      - Generate tests
/coverage      - Check test coverage
/test-watch    - Enable test watching
/mock          - Generate mocks
```

### Review Commands
```
/review        - Full code review
/security      - Security analysis
/perf          - Performance review
/quality       - Quality metrics
/lint          - Run linters
```

### Navigation Commands
```
/goto <file>   - Navigate to file
/find <text>   - Search in project
/recent        - Recent files
/bookmark      - Bookmark location
/history       - Command history
```

### Role Commands
```
/switch        - Switch driver/navigator
/mode <type>   - Change mode
/role          - Show current role
/handoff       - Prepare role handoff
```

### Git Commands
```
/diff          - Show changes
/commit        - Commit with verification
/branch        - Branch operations
/stash         - Stash changes
/log           - View git log
```

## Session Status

Check current session status:

```bash
monobrain pair --status
```

Output:
```
👥 Pair Programming Session
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Session ID: pair_1755021234567
Duration: 45 minutes
Status: Active

Partner: senior-dev
Current Role: DRIVER (you)
Mode: Switch (10m intervals)
Next Switch: in 3 minutes

📊 Metrics:
├── Truth Score: 0.982 ✅
├── Lines Changed: 234
├── Files Modified: 5
├── Tests Added: 12
├── Coverage: 87% ↑3%
└── Commits: 3

🎯 Focus: Implementation
📝 Current File: src/auth/login.js
```

## Session History

View past sessions:

```bash
monobrain pair --history
```

Output:
```
📚 Session History
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 2024-01-15 14:30 - 16:45 (2h 15m)
   Partner: expert-coder
   Focus: Refactoring
   Truth Score: 0.975
   Changes: +340 -125 lines

2. 2024-01-14 10:00 - 11:30 (1h 30m)
   Partner: tdd-specialist
   Focus: Testing
   Truth Score: 0.991
   Tests Added: 24

3. 2024-01-13 15:00 - 17:00 (2h)
   Partner: debugger-expert
   Focus: Bug Fixing
   Truth Score: 0.968
   Issues Fixed: 5
```

## Session Metrics

Real-time metrics during session:

### Truth Score
```
Current: 0.982 ✅
Average: 0.975
Minimum: 0.951
Threshold: 0.950
```

### Productivity
```
Lines Changed: 234
Files Modified: 5
Functions Added: 8
Functions Refactored: 3
```

### Quality
```
Test Coverage: 87% ↑3%
Lint Issues: 0
Security Issues: 0
Performance Issues: 1 ⚠️
```

### Collaboration
```
Suggestions Given: 45
Suggestions Accepted: 38 (84%)
Reviews Completed: 12
Rollbacks: 1
```

## Session Persistence

### Save Session
```bash
monobrain pair --save [--name <name>]
```

### Load Session
```bash
monobrain pair --load <session-id>
```

### Export Session
```bash
monobrain pair --export <session-id> [--format json|md]
```

## Background Sessions

Run pair programming in background:

### Start Background Session
```bash
monobrain pair --start --background
```

### Monitor Background Session
```bash
monobrain pair --monitor
```

### Attach to Background Session
```bash
monobrain pair --attach <session-id>
```

## Session Configuration

### Default Settings
```json
{
  "pair": {
    "session": {
      "autoSave": true,
      "saveInterval": "5m",
      "maxDuration": "4h",
      "idleTimeout": "15m",
      "metricsInterval": "1m"
    }
  }
}
```

### Per-Session Config
```bash
monobrain pair --start \
  --config custom-config.json
```

## Session Templates

### Refactoring Template
```bash
monobrain pair --template refactor
```
- Focus: Code improvement
- Verification: High (0.98)
- Testing: After each change
- Review: Continuous

### Feature Template
```bash
monobrain pair --template feature
```
- Focus: Implementation
- Verification: Standard (0.95)
- Testing: On completion
- Review: Pre-commit

### Debug Template
```bash
monobrain pair --template debug
```
- Focus: Problem solving
- Verification: Moderate (0.90)
- Testing: Regression tests
- Review: Root cause

### Learning Template
```bash
monobrain pair --template learn
```
- Mode: Mentor
- Pace: Slow
- Explanations: Detailed
- Examples: Many

## Session Reports

Generate session report:

```bash
monobrain pair --report <session-id>
```

Report includes:
- Session summary
- Metrics overview
- Code changes
- Test results
- Quality scores
- Learning points
- Recommendations

## Multi-Session Management

### List Active Sessions
```bash
monobrain pair --list
```

### Switch Between Sessions
```bash
monobrain pair --switch <session-id>
```

### Merge Sessions
```bash
monobrain pair --merge <session-1> <session-2>
```

## Session Recovery

### Auto-Recovery
Sessions auto-save every 5 minutes with recovery points.

### Manual Recovery
```bash
monobrain pair --recover [--point <timestamp>]
```

### Crash Recovery
```bash
monobrain pair --crash-recovery
```

## Session Sharing

### Share with Team
```bash
monobrain pair --share <session-id> \
  --team <team-id>
```

### Export for Review
```bash
monobrain pair --export-review <session-id>
```

### Create Learning Material
```bash
monobrain pair --create-tutorial <session-id>
```

## Advanced Features

### Session Recording
```bash
monobrain pair --start --record
```
Records all interactions for playback.

### Session Replay
```bash
monobrain pair --replay <session-id>
```
Replay recorded session for learning.

### Session Analytics
```bash
monobrain pair --analytics <session-id>
```
Deep analysis of session patterns.

## Troubleshooting

### Session Won't Start
- Check agent availability
- Verify configuration
- Ensure clean workspace

### Session Disconnected
- Use `--recover` to restore
- Check network connection
- Verify background processes

### Poor Performance
- Reduce verification threshold
- Disable continuous testing
- Check system resources

## Best Practices

1. **Regular Saves** - Auto-save enabled
2. **Clear Goals** - Define objectives
3. **Appropriate Duration** - 1-2 hour sessions
4. **Breaks** - Take regular breaks
5. **Review** - End with summary

## Related Commands

- `pair --start` - Start new session
- `pair --config` - Configure settings
- `pair --templates` - Manage templates
- `pair --analytics` - View analytics