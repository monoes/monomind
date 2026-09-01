# Path Validator — Best Practices

## Focus
Guards filesystem access from path traversal and injection — ensures any user-influenced path resolves inside its intended base directory before it's ever opened, read, or written.

## Best practices
- Avoid passing user-supplied input to filesystem APIs at all where possible — offer a fixed set of choices (an ID mapped server-side to a path) instead of a raw path
- When a path must be accepted, canonicalize it first: resolve `.`, `..`, and symlinks to get the true final path before making any decision
- Validate *after* decoding, never before — attackers stack multiple encoding layers (`%2e%2e/`, double-encoding, unicode variants) specifically to slip past pre-decode filters
- After canonicalizing, verify the resolved path starts with the expected base directory (prefix check on the canonical form, not the raw string)
- Restrict accepted filenames/extensions to an explicit allowlist (alphanumeric plus a small safe character set) rather than trying to blocklist dangerous sequences
- Treat every uploaded filename as untrusted — never use the client-supplied filename directly for storage; generate or map it server-side
- Apply the same canonicalize-then-prefix-check logic on every OS you deploy to — Windows path semantics (`\`, drive letters, alternate streams) differ from POSIX and need their own checks

## Common pitfalls
- Blocklisting `../` as a raw string match — trivially defeated by encoding, mixed separators, or double-encoded sequences
- Doing the base-directory prefix check on the raw input instead of the canonicalized path, so `../../etc/passwd` slips through pre-resolution
- Forgetting symlinks: a filename can be "inside" the base directory while a symlink underneath it points somewhere else entirely
- Validating the extension but not the full path, letting `evil.php%00.jpg`-style null-byte or double-extension tricks through
- Assuming validation done once at upload time still holds when the file is later moved, renamed, or accessed via a different code path

## Tools & techniques
- Canonicalization APIs (`realpath`, `Path.resolve`/`Path.normalize` + prefix check, `os.path.realpath`) as the mandatory first step before any comparison
- Explicit base-directory containment check: canonical path must start with canonical base directory + separator, not just a substring match
- Filename allowlist regex (e.g. `^[a-zA-Z0-9._-]+$`) combined with a maximum length limit
- Chroot/jail, containerized filesystem mounts, or scoped storage buckets as a second layer of defense beyond application-level checks
- Automated test cases covering `../`, encoded traversal, symlink escapes, and null-byte injection for every path-accepting endpoint
