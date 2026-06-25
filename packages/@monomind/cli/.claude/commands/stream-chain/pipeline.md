---
name: stream-chain:pipeline
description: Execute predefined stream-chain pipelines for common development workflows — analysis, refactor, test, optimize. Each step feeds full context into the next.
---

# Stream-Chain Pipeline Mode

Execute predefined multi-step workflows where each step's output flows into the next as context.

## How to Invoke

In Claude Code, activate pipeline mode:
```
Skill("stream-chain:pipeline")
```

Then tell Claude which pipeline to run and on what target:
> "Run the analysis pipeline on the `src/auth/` directory."
> "Run the refactor pipeline on `UserService.ts`."

---

## Available Pipelines

### analysis

Comprehensive codebase analysis and improvement identification.

**Steps:**
1. Map directory structure and identify main components
2. Identify potential improvements and issues
3. Generate actionable improvement report with priorities

**When to use:** New codebase onboarding, technical debt assessment, architecture review, code quality audits.

---

### refactor

Systematic code refactoring with prioritization.

**Steps:**
1. Find code that would benefit from refactoring
2. Create prioritized refactoring plan with specific changes
3. Provide refactored code for top 3 priorities

**When to use:** Technical debt reduction, code quality improvement, design pattern implementation.

---

### test

Comprehensive test generation with coverage analysis.

**Steps:**
1. Identify areas lacking test coverage
2. Design test cases for critical functions
3. Generate unit test implementations with assertions

**When to use:** Increasing test coverage, TDD workflow support, regression test creation.

---

### optimize

Performance optimization with profiling and implementation.

**Steps:**
1. Profile codebase and identify performance bottlenecks
2. Analyze bottlenecks and suggest optimization strategies
3. Provide optimized implementations for main issues

**When to use:** Performance improvement, resource optimization, latency reduction.

---

## Running Pipelines

After invoking the skill, direct Claude conversationally:

> "Run the test pipeline on all files in `src/services/`."
> "Run the optimization pipeline, focus on database query patterns."
> "Run the analysis pipeline, then the refactor pipeline on the findings."

## Chaining Pipelines

Run multiple pipelines sequentially for a full QA cycle:
```
analysis → refactor → test → optimize
```

> "Run a full QA chain: analysis, then refactor, then test on the resulting changes."

## Custom Pipelines

For repeatable custom pipelines, define the steps explicitly:

> "Run a custom pipeline on the payment module:
> 1. Scan for security vulnerabilities
> 2. Categorize issues by severity
> 3. Generate fixes with priority
> 4. Create security test cases"

Or use the `stream-chain:run` mode for ad-hoc custom chains.

## Pipeline Output

Each pipeline step delivers:
- Step-by-step progress and results
- Success/failure status per step
- Consolidated summary of findings
- Actionable recommendations

## See Also
- `stream-chain:run` — custom prompt chains with full control
- `stream-chain` — full stream-chain skill with advanced patterns
