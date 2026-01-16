# ADR-046: Dual Umbrella Packages — monobrain + monobrain

**Status:** Accepted
**Date:** 2026-02-07
**Updated:** 2026-02-08
**Authors:** RuvNet, Monobrain Team

## Context

The umbrella package is published to npm as `monobrain`. As the ecosystem grows and the product establishes its own identity, a second umbrella package `monobrain` is introduced alongside the original.

### Current State

| Aspect            | Current Value       |
| ----------------- | ------------------- |
| npm package       | `monobrain`         |
| CLI binary        | `monobrain`         |
| GitHub repo       | nokhodian/monobrain |
| Internal packages | @monobrain/\*       |
| Weekly downloads  | ~1,000+             |

### Drivers for Change

1. **Brand Cohesion**: Aligns with the ruv ecosystem (ruv.io, @ruvector/\*, ruv-swarm)
2. **Trademark Safety**: Removes potential trademark concerns with "Claude" in product name
3. **Product Identity**: Establishes independent product identity beyond Claude integration
4. **Discoverability**: "monobrain" is unique, memorable, and searchable
5. **Future Flexibility**: Enables the platform to support multiple AI backends without name confusion
6. **Zero Disruption**: Keeping `monobrain` ensures no existing users are broken

## Decision

Publish **two independent npm umbrella packages** — `monobrain` (original) and `monobrain` (new) — both backed by `@monobrain/cli`.

### Package Architecture

```
npm registry
├── monobrain          ← original umbrella (bundles @monobrain/cli)
│   └── bin: monobrain → packages/@monobrain/cli/bin/cli.js
├── monobrain              ← new umbrella (depends on @monobrain/cli)
│   └── bin: monobrain     → @monobrain/cli/bin/cli.js
└── @monobrain/cli     ← shared CLI implementation
```

### What Changes

| Aspect           | Before                 | After                                                  |
| ---------------- | ---------------------- | ------------------------------------------------------ |
| npm packages     | `monobrain` only       | `monobrain` + `monobrain`                              |
| CLI binaries     | `monobrain`            | `monobrain` + `monobrain`                              |
| Install commands | `npx monobrain@latest` | Both `npx monobrain@latest` and `npx monobrain@latest` |
| README branding  | "Monobrain"            | "Monobrain" (primary), "monobrain" (supported)         |
| Product name     | Monobrain              | Monobrain (with monobrain alias)                       |

### What Stays the Same

| Aspect                  | Value               | Reason                                    |
| ----------------------- | ------------------- | ----------------------------------------- |
| GitHub repo             | nokhodian/monobrain | SEO, existing links, history              |
| Internal packages       | @monobrain/\*       | Minimal disruption, existing integrations |
| Functionality           | All features        | No functional changes                     |
| License                 | MIT                 | No change                                 |
| Author                  | RuvNet              | No change                                 |
| `monobrain` npm package | Fully supported     | No breaking changes for existing users    |

## Consequences

### Positive

1. **Zero Disruption**: Existing `monobrain` users unaffected
2. **Unified Brand**: New `monobrain` package for the ruv ecosystem
3. **Trademark Safety**: Users can choose the non-"Claude" branded package
4. **Dual Discovery**: Package discoverable under both names on npm
5. **Future Proof**: Can add non-Claude integrations without name confusion

### Negative

1. **Two packages to maintain**: Must publish and tag both packages
2. **Documentation**: Must reference both package names
3. **Download split**: npm download stats split across two packages

### Neutral

1. **GitHub repo unchanged**: Existing links continue to work
2. **Internal packages unchanged**: No code changes required in @monobrain/\*

## Implementation

### Package Structure

```
/workspaces/monobrain/
├── package.json            # name: "monobrain" (original umbrella)
│                           # bin: monobrain → packages/@monobrain/cli/bin/cli.js
│                           # bundles CLI files directly
└── monobrain/
    ├── package.json        # name: "monobrain" (new umbrella)
    │                       # bin: monobrain → ./bin/monobrain.js
    │                       # depends on @monobrain/cli
    ├── bin/
    │   └── monobrain.js      # thin wrapper, imports @monobrain/cli
    └── README.md           # Monobrain-branded docs
```

### Phase 1: Preparation (This PR)

1. Create ADR-046 (this document)
2. Keep root `package.json` as `monobrain` (original umbrella)
3. Create `monobrain/` directory with new umbrella package
4. Update main README.md with Monobrain branding
5. Update install scripts to reference `monobrain`

### Phase 2: Publishing

```bash
# 1. Publish @monobrain/cli (shared implementation)
cd packages/@monobrain/cli
npm publish --tag alpha

# 2. Publish monobrain umbrella (original)
cd /workspaces/monobrain
npm publish --tag v1alpha
npm dist-tag add monobrain@<version> latest
npm dist-tag add monobrain@<version> alpha

# 3. Publish monobrain umbrella (new)
cd /workspaces/monobrain/monobrain
npm publish --tag alpha
npm dist-tag add monobrain@<version> latest
```

### Phase 3: Ongoing

1. Both packages maintained indefinitely
2. Version numbers kept in sync
3. README shows both install options
4. `monobrain` promoted as primary in new documentation

## Publishing Checklist

When publishing updates, **all three packages** must be published:

| Order | Package          | Command                     | Tags                   |
| ----- | ---------------- | --------------------------- | ---------------------- |
| 1     | `@monobrain/cli` | `npm publish --tag alpha`   | alpha, latest          |
| 2     | `monobrain`      | `npm publish --tag v1alpha` | v1alpha, alpha, latest |
| 3     | `monobrain`      | `npm publish --tag alpha`   | alpha, latest          |

## Alternatives Considered

### 1. Replace monobrain with monobrain (single package)

**Pros:** Simpler, one package to maintain
**Cons:** Breaks existing users, loses download history
**Decision:** Rejected - zero disruption preferred

### 2. Rename to ruv-flow (hyphenated)

**Pros:** Matches ruv-swarm pattern
**Cons:** Inconsistent with @ruvector (no hyphen)
**Decision:** Rejected - "monobrain" is cleaner and matches ruvector pattern

### 3. Rename internal packages too (@monobrain/\*)

**Pros:** Complete rebrand
**Cons:** Major breaking change, complex migration, npm scope registration
**Decision:** Rejected - disruption not worth the benefit

### 4. Deprecate monobrain

**Pros:** Forces migration to monobrain
**Cons:** Breaks existing users, bad developer experience
**Decision:** Rejected - both packages coexist permanently

## Migration Guide

### For New Users

```bash
# Recommended
npx monobrain@latest init --wizard

# Also works
npx monobrain@latest init --wizard
```

### For Existing Users

No migration required. `monobrain` continues to work. Optionally switch:

```bash
# Switch MCP server (optional)
claude mcp remove monobrain
claude mcp add monobrain npx monobrain@latest mcp start
```

### For Contributors

1. Root `package.json` is the `monobrain` umbrella
2. `monobrain/package.json` is the `monobrain` umbrella
3. Internal imports remain `@monobrain/*`
4. GitHub repo remains `nokhodian/monobrain`

## Metrics for Success

| Metric                 | Target                       | Measurement                      |
| ---------------------- | ---------------------------- | -------------------------------- |
| Combined npm downloads | Maintain or grow             | npm weekly stats (both packages) |
| GitHub stars           | Maintain or grow             | GitHub metrics                   |
| Issues from confusion  | < 10 in 30 days              | GitHub issues                    |
| monobrain adoption     | 50%+ new installs in 90 days | npm stats                        |

## References

- GitHub Issue: #1101
- npm: https://npmjs.com/package/monobrain
- npm: https://npmjs.com/package/monobrain
- Related: ADR-017 (RuVector Integration)

## Appendix: Branding Guidelines

### Product Names

| Context      | Use                                          |
| ------------ | -------------------------------------------- |
| npm packages | `monobrain` and `monobrain` (both lowercase) |
| README title | "Monobrain" (PascalCase)                     |
| CLI binaries | `monobrain` or `monobrain` (both lowercase)  |
| In prose     | "Monobrain" (PascalCase)                     |

### Command Examples

```bash
# New recommended style
npx monobrain@latest init
npx monobrain@latest agent spawn -t coder
npx monobrain@latest swarm init --topology hierarchical

# Legacy style (still fully supported)
npx monobrain@latest init
npx monobrain@latest agent spawn -t coder
```

---

**Decision Date:** 2026-02-07
**Updated:** 2026-02-08
**Review Date:** 2026-03-07 (30 days post-implementation)
