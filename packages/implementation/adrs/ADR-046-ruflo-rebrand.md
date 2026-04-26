# ADR-046: Dual Umbrella Packages — monomind + monomind

**Status:** Accepted
**Date:** 2026-02-07
**Updated:** 2026-02-08
**Authors:** RuvNet, Monomind Team

## Context

The umbrella package is published to npm as `monomind`. As the ecosystem grows and the product establishes its own identity, a second umbrella package `monomind` is introduced alongside the original.

### Current State

| Aspect            | Current Value       |
| ----------------- | ------------------- |
| npm package       | `monomind`         |
| CLI binary        | `monomind`         |
| GitHub repo       | nokhodian/monomind |
| Internal packages | @monomind/\*       |
| Weekly downloads  | ~1,000+             |

### Drivers for Change

1. **Brand Cohesion**: Aligns with the Monomind ecosystem (@monomind/\*, monomind)
2. **Trademark Safety**: Removes potential trademark concerns with "Claude" in product name
3. **Product Identity**: Establishes independent product identity beyond Claude integration
4. **Discoverability**: "monomind" is unique, memorable, and searchable
5. **Future Flexibility**: Enables the platform to support multiple AI backends without name confusion
6. **Zero Disruption**: Keeping `monomind` ensures no existing users are broken

## Decision

Publish **two independent npm umbrella packages** — `monomind` (original) and `monomind` (new) — both backed by `@monomind/cli`.

### Package Architecture

```
npm registry
├── monomind          ← original umbrella (bundles @monomind/cli)
│   └── bin: monomind → packages/@monomind/cli/bin/cli.js
├── monomind              ← new umbrella (depends on @monomind/cli)
│   └── bin: monomind     → @monomind/cli/bin/cli.js
└── @monomind/cli     ← shared CLI implementation
```

### What Changes

| Aspect           | Before                 | After                                                  |
| ---------------- | ---------------------- | ------------------------------------------------------ |
| npm packages     | `monomind` only       | `monomind` + `monomind`                              |
| CLI binaries     | `monomind`            | `monomind` + `monomind`                              |
| Install commands | `npx monomind@latest` | Both `npx monomind@latest` and `npx monomind@latest` |
| README branding  | "Monomind"            | "Monomind" (primary), "monomind" (supported)         |
| Product name     | Monomind              | Monomind (with monomind alias)                       |

### What Stays the Same

| Aspect                  | Value               | Reason                                    |
| ----------------------- | ------------------- | ----------------------------------------- |
| GitHub repo             | nokhodian/monomind | SEO, existing links, history              |
| Internal packages       | @monomind/\*       | Minimal disruption, existing integrations |
| Functionality           | All features        | No functional changes                     |
| License                 | MIT                 | No change                                 |
| Author                  | RuvNet              | No change                                 |
| `monomind` npm package | Fully supported     | No breaking changes for existing users    |

## Consequences

### Positive

1. **Zero Disruption**: Existing `monomind` users unaffected
2. **Unified Brand**: New `monomind` package for the ruv ecosystem
3. **Trademark Safety**: Users can choose the non-"Claude" branded package
4. **Dual Discovery**: Package discoverable under both names on npm
5. **Future Proof**: Can add non-Claude integrations without name confusion

### Negative

1. **Two packages to maintain**: Must publish and tag both packages
2. **Documentation**: Must reference both package names
3. **Download split**: npm download stats split across two packages

### Neutral

1. **GitHub repo unchanged**: Existing links continue to work
2. **Internal packages unchanged**: No code changes required in @monomind/\*

## Implementation

### Package Structure

```
/workspaces/monomind/
├── package.json            # name: "monomind" (original umbrella)
│                           # bin: monomind → packages/@monomind/cli/bin/cli.js
│                           # bundles CLI files directly
└── monomind/
    ├── package.json        # name: "monomind" (new umbrella)
    │                       # bin: monomind → ./bin/monomind.js
    │                       # depends on @monomind/cli
    ├── bin/
    │   └── monomind.js      # thin wrapper, imports @monomind/cli
    └── README.md           # Monomind-branded docs
```

### Phase 1: Preparation (This PR)

1. Create ADR-046 (this document)
2. Keep root `package.json` as `monomind` (original umbrella)
3. Create `monomind/` directory with new umbrella package
4. Update main README.md with Monomind branding
5. Update install scripts to reference `monomind`

### Phase 2: Publishing

```bash
# 1. Publish @monomind/cli (shared implementation)
cd packages/@monomind/cli
npm publish --tag alpha

# 2. Publish monomind umbrella (original)
cd /workspaces/monomind
npm publish --tag v1alpha
npm dist-tag add monomind@<version> latest
npm dist-tag add monomind@<version> alpha

# 3. Publish monomind umbrella (new)
cd /workspaces/monomind/monomind
npm publish --tag alpha
npm dist-tag add monomind@<version> latest
```

### Phase 3: Ongoing

1. Both packages maintained indefinitely
2. Version numbers kept in sync
3. README shows both install options
4. `monomind` promoted as primary in new documentation

## Publishing Checklist

When publishing updates, **all three packages** must be published:

| Order | Package          | Command                     | Tags                   |
| ----- | ---------------- | --------------------------- | ---------------------- |
| 1     | `@monomind/cli` | `npm publish --tag alpha`   | alpha, latest          |
| 2     | `monomind`      | `npm publish --tag v1alpha` | v1alpha, alpha, latest |
| 3     | `monomind`      | `npm publish --tag alpha`   | alpha, latest          |

## Alternatives Considered

### 1. Replace monomind with monomind (single package)

**Pros:** Simpler, one package to maintain
**Cons:** Breaks existing users, loses download history
**Decision:** Rejected - zero disruption preferred

### 2. Rename to ruv-flow (hyphenated)

**Pros:** Matches ruv-swarm pattern
**Cons:** Inconsistent with @ruvector (no hyphen)
**Decision:** Rejected - "monomind" is cleaner and matches ruvector pattern

### 3. Rename internal packages too (@monomind/\*)

**Pros:** Complete rebrand
**Cons:** Major breaking change, complex migration, npm scope registration
**Decision:** Rejected - disruption not worth the benefit

### 4. Deprecate monomind

**Pros:** Forces migration to monomind
**Cons:** Breaks existing users, bad developer experience
**Decision:** Rejected - both packages coexist permanently

## Migration Guide

### For New Users

```bash
# Recommended
npx monomind@latest init --wizard

# Also works
npx monomind@latest init --wizard
```

### For Existing Users

No migration required. `monomind` continues to work. Optionally switch:

```bash
# Switch MCP server (optional)
claude mcp remove monomind
claude mcp add monomind npx monomind@latest mcp start
```

### For Contributors

1. Root `package.json` is the `monomind` umbrella
2. `monomind/package.json` is the `monomind` umbrella
3. Internal imports remain `@monomind/*`
4. GitHub repo remains `nokhodian/monomind`

## Metrics for Success

| Metric                 | Target                       | Measurement                      |
| ---------------------- | ---------------------------- | -------------------------------- |
| Combined npm downloads | Maintain or grow             | npm weekly stats (both packages) |
| GitHub stars           | Maintain or grow             | GitHub metrics                   |
| Issues from confusion  | < 10 in 30 days              | GitHub issues                    |
| monomind adoption     | 50%+ new installs in 90 days | npm stats                        |

## References

- GitHub Issue: #1101
- npm: https://npmjs.com/package/monomind
- npm: https://npmjs.com/package/monomind
- Related: ADR-017 (RuVector Integration)

## Appendix: Branding Guidelines

### Product Names

| Context      | Use                                          |
| ------------ | -------------------------------------------- |
| npm packages | `monomind` and `monomind` (both lowercase) |
| README title | "Monomind" (PascalCase)                     |
| CLI binaries | `monomind` or `monomind` (both lowercase)  |
| In prose     | "Monomind" (PascalCase)                     |

### Command Examples

```bash
# New recommended style
npx monomind@latest init
npx monomind@latest agent spawn -t coder
npx monomind@latest swarm init --topology hierarchical

# Legacy style (still fully supported)
npx monomind@latest init
npx monomind@latest agent spawn -t coder
```

---

**Decision Date:** 2026-02-07
**Updated:** 2026-02-08
**Review Date:** 2026-03-07 (30 days post-implementation)
