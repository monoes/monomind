# pair --start

Start a new pair programming session with AI assistance.

## Usage

```bash
monobrain pair --start [options]
```

## Options

- `--agent <name>` - AI pair partner (default: auto-select)
- `--mode <type>` - Programming mode: driver, navigator, switch
- `--verify` - Enable real-time verification
- `--threshold <0-1>` - Verification threshold (default: 0.95)
- `--focus <area>` - Focus area: refactor, test, debug, implement
- `--language <lang>` - Primary programming language
- `--review` - Enable continuous code review
- `--test` - Run tests after each change
- `--interval <time>` - Switch interval for switch mode (default: 10m)

## Examples

### Basic Start
```bash
monobrain pair --start
```

### Expert Refactoring Session
```bash
monobrain pair --start \
  --agent senior-dev \
  --focus refactor \
  --verify \
  --threshold 0.98
```

### TDD Session
```bash
monobrain pair --start \
  --mode driver \
  --focus test \
  --test \
  --language javascript
```

### Debugging Session
```bash
monobrain pair --start \
  --agent debugger-expert \
  --focus debug \
  --review
```

## Session Initialization

When starting a session, the system:

1. **Selects AI Partner** - Matches expertise to your needs
2. **Configures Environment** - Sets up verification and testing
3. **Establishes Roles** - Defines driver/navigator responsibilities
4. **Loads Context** - Imports project information
5. **Begins Monitoring** - Tracks quality metrics

## Modes Explained

### Driver Mode
You write code while AI:
- Provides real-time suggestions
- Reviews changes instantly
- Catches potential issues
- Suggests improvements

### Navigator Mode
AI writes code while you:
- Provide high-level guidance
- Review generated code
- Request modifications
- Control direction

### Switch Mode
Automatically alternates roles:
- Default: 10-minute intervals
- Configurable timing
- Smooth handoffs
- Shared context

## Focus Areas

### Refactor
- Code structure improvements
- Pattern implementation
- Performance optimization
- Readability enhancement

### Test
- Test-driven development
- Test coverage improvement
- Edge case identification
- Mock creation

### Debug
- Issue identification
- Root cause analysis
- Fix suggestions
- Prevention strategies

### Implement
- Feature development
- API creation
- UI components
- Business logic

## Quality Features

### Verification
- Real-time truth scoring
- Automatic rollback on failures
- Quality gates before commits
- Continuous monitoring

### Code Review
- Instant feedback
- Best practice enforcement
- Security scanning
- Performance analysis

### Testing
- Automatic test generation
- Coverage tracking
- Integration suggestions
- Regression prevention

## Session Output

```
👥 Pair Programming Session Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Session ID: pair_1755021234567
Partner: senior-dev
Mode: Switch (10m intervals)
Focus: Implementation
Language: JavaScript

Verification: ✅ Enabled (0.95 threshold)
Testing: ✅ Auto-run on save
Review: ✅ Continuous

Current Role: DRIVER (you)
Navigator: senior-dev is ready...

📝 Workspace: /workspaces/my-project
📊 Truth Score: 0.972 ✅
🧪 Test Coverage: 84%

Type /help for commands or start coding...
```

## Background Execution

Start sessions in background for long-running collaboration:

```bash
# Start in background
monobrain pair --start --background

# Monitor session
monobrain pair status

# View session output
monobrain pair output session_id

# End background session
monobrain pair --end session_id
```

## Integration

### With Git
```bash
monobrain pair --start --git --auto-commit
```

### With CI/CD
```bash
monobrain pair --start --ci --non-interactive
```

### With IDE
```bash
monobrain pair --start --ide vscode
```

## Best Practices

1. **Clear Goals** - Define session objectives
2. **Appropriate Mode** - Choose based on task
3. **Enable Verification** - For critical code
4. **Regular Testing** - Maintain quality
5. **Session Notes** - Document decisions

## Related Commands

- `pair --end` - End current session
- `pair --status` - Check session status
- `pair --history` - View past sessions
- `pair --config` - Configure defaults