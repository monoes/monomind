# Local Development Configuration

## Environment Variables

```bash
MONOMIND_CONFIG=./monomind.config.json
MONOMIND_LOG_LEVEL=info
MONOMIND_MEMORY_BACKEND=hybrid
MONOMIND_MEMORY_PATH=./data/memory
MONOMIND_MCP_PORT=3000
MONOMIND_MCP_TRANSPORT=stdio
```

## Plugin Registry Maintenance (IPFS/Pinata)

Registry CID stored in: `packages/@monomind/cli/src/plugins/store/discovery.ts`
Gateway: `https://gateway.pinata.cloud/ipfs/{CID}`

Steps to add a plugin:
1. Fetch current registry: `curl -s "https://gateway.pinata.cloud/ipfs/$(grep LIVE_REGISTRY_CID packages/@monomind/cli/src/plugins/store/discovery.ts | cut -d"'" -f2)" > /tmp/registry.json`
2. Add plugin entry to `plugins` array, increment `totalPlugins`, update category counts
3. Upload: `curl -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" -H "Authorization: Bearer $PINATA_JWT" -H "Content-Type: application/json" -d @/tmp/registry.json`
4. Update `LIVE_REGISTRY_CID` in discovery.ts and the `demoPluginRegistry` fallback

Security: NEVER hardcode API keys. Source from .env at runtime. NEVER commit .env.

## Doctor Health Checks

`npx monomind@latest doctor` checks: Node 20+, npm 9+, git, config, daemon, memory DB, API keys, MCP servers, disk space, TypeScript.

## Hooks Quick Reference

```bash
npx monomind@latest hooks pre-task --description "[task]"
npx monomind@latest hooks post-task --task-id "[id]" --success true
npx monomind@latest hooks session-start --session-id "[id]"
npx monomind@latest hooks route --task "[task]"
npx monomind@latest hooks worker list
```

## Intelligence System (RuVector)

4-step pipeline: RETRIEVE (HNSW) → JUDGE (verdicts) → DISTILL (LoRA) → CONSOLIDATE (EWC++)

Components: SONA (<0.05ms), MoE (8 experts), HNSW (150x-12,500x), Flash Attention (2.49x-7.47x)
