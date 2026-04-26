# Monomind v1.5 — Optimized Production Image
# Multi-stage Alpine build with --omit=optional for <100MB image
#
# Build:
#   docker build -t monomind:lite -f v1/@monomind/cli/docker/Dockerfile .
#
# Run:
#   docker run --rm monomind:lite monomind --version
#   docker run --rm monomind:lite monomind doctor
#   echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | docker run --rm -i monomind:lite
#
# Size comparison:
#   npx monomind@latest (cold): ~1.3GB, 914 packages, 35s startup
#   monomind:lite image:        <100MB, ~60 packages, <5s startup

# ── Stage 1: Install ─────────────────────────────────────────────
FROM node:22-alpine AS build

RUN apk add --no-cache git

WORKDIR /install

# Install monomind globally with --omit=optional to skip heavy deps.
# --ignore-scripts skips preinstall cache scanning (no-op in CI)
RUN npm install -g monomind@latest \
      --omit=optional \
      --ignore-scripts \
      --no-audit \
      --no-fund \
    && npm cache clean --force

# Prune heavy optional transitive deps that npm still resolves.
# These are all optionalDependencies of @monomind/cli — the CLI
# works fine without them (graceful fallbacks built in).
#   agentic-flow: 238MB (ONNX runtimes, OpenTelemetry, Anthropic SDK)
#   @opentelemetry: 135MB (transitive via agentic-flow)
#   onnxruntime-node/web: 158MB (ML inference, not needed for CLI)
#   @anthropic-ai: 72MB (SDK, only needed when calling API directly)
#   @xenova: 45MB (transformers.js, not needed for CLI)
#   agentdb: 37MB (optional memory backend)
#   @ruvector: 28MB (optional neural patterns)
#   ruvector: 9MB (optional intelligence)
#   onnx-proto: 22MB (protobuf for ONNX)
#   tiktoken: 23MB (token counting, optional)
#   @img: 16MB (image processing, not needed)
#   better-sqlite3: 10MB (native, optional — sql.js used instead)
RUN GLOBAL_PREFIX=$(npm config get prefix) \
    && CLI_NM="${GLOBAL_PREFIX}/lib/node_modules/monomind/node_modules" \
    && rm -rf \
      "${CLI_NM}/agentic-flow" \
      "${CLI_NM}/@opentelemetry" \
      "${CLI_NM}/onnxruntime-node" \
      "${CLI_NM}/onnxruntime-web" \
      "${CLI_NM}/onnx-proto" \
      "${CLI_NM}/@anthropic-ai" \
      "${CLI_NM}/@xenova" \
      "${CLI_NM}/agentdb" \
      "${CLI_NM}/@ruvector" \
      "${CLI_NM}/ruvector" \
      "${CLI_NM}/tiktoken" \
      "${CLI_NM}/@img" \
      "${CLI_NM}/better-sqlite3" \
      "${CLI_NM}/sharp" \
      "${CLI_NM}/@google" \
    && rm -rf \
      "${CLI_NM}/@monomind/embeddings" \
      "${CLI_NM}/@monomind/memory" \
      "${CLI_NM}/@monomind/guidance" \
      "${CLI_NM}/@monomind/aidefence" \
      "${CLI_NM}/@monomind/plugin-gastown-bridge" \
    && NESTED="${CLI_NM}/@monomind/cli/node_modules" \
    && rm -rf \
      "${NESTED}/agentic-flow" \
      "${NESTED}/@ruvector" \
      "${NESTED}/agentdb" \
    && rm -rf \
      "${CLI_NM}/ruvector-onnx-embeddings-wasm" \
      "${CLI_NM}/ruvector-core-linux-x64-gnu" \
      "${CLI_NM}/@monomind/neural" \
      "${CLI_NM}/@grpc" \
      "${CLI_NM}/gun"

# Stage the pruned install for the production image
RUN GLOBAL_PREFIX=$(npm config get prefix) \
    && mkdir -p /staged/lib /staged/bin \
    && cp -a "${GLOBAL_PREFIX}/lib/node_modules" /staged/lib/ \
    && cp -a "${GLOBAL_PREFIX}/bin/monomind" /staged/bin/ 2>/dev/null || true \
    && cp -a "${GLOBAL_PREFIX}/bin/monomind" /staged/bin/ 2>/dev/null || true \
    && cp -a "${GLOBAL_PREFIX}/bin/cli" /staged/bin/ 2>/dev/null || true

# ── Stage 2: Production ──────────────────────────────────────────
FROM node:22-alpine AS production

# dumb-init for proper PID 1 signal handling
RUN apk add --no-cache dumb-init git bash ca-certificates curl

# Non-root user
RUN addgroup -g 1001 -S monomind \
    && adduser -S -D -H -u 1001 -h /home/monomind -s /bin/bash -G monomind monomind \
    && mkdir -p /home/monomind/.monomind /workspace \
    && chown -R monomind:monomind /home/monomind /workspace

# Copy only the global node_modules and bin links from build stage
COPY --from=build /staged/lib/node_modules /usr/local/lib/node_modules
COPY --from=build /staged/bin/ /usr/local/bin/

# Ensure bin symlinks point to the right place
RUN ln -sf /usr/local/lib/node_modules/monomind/bin/monomind.js /usr/local/bin/monomind 2>/dev/null || true \
    && ln -sf /usr/local/lib/node_modules/@monomind/cli/bin/cli.js /usr/local/bin/monomind 2>/dev/null || true \
    && chmod +x /usr/local/bin/monomind 2>/dev/null || true \
    && chmod +x /usr/local/bin/monomind 2>/dev/null || true

ENV NODE_ENV=production \
    MONOMIND_LOG_LEVEL=info \
    HOME=/home/monomind

# Healthcheck via CLI doctor (timeout after 10s)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD monomind doctor --quiet || exit 1

USER monomind
WORKDIR /workspace

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default: start MCP server on stdio (most common Docker use case)
CMD ["monomind", "mcp", "start"]
