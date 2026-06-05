/**
 * CLI MonoVector Setup Command
 * Outputs Docker files and SQL for easy MonoVector PostgreSQL setup
 *
 * Usage:
 *   npx monomind monovector setup              # Output to ./monovector-postgres/
 *   npx monomind monovector setup --output /path/to/dir
 *   npx monomind monovector setup --print      # Print to stdout only
 *
 * https://github.com/nokhodian/monomind
 */
import { output } from '../../output.js';
import * as fs from 'fs';
import * as path from 'path';
/**
 * Docker Compose template for MonoVector PostgreSQL
 */
const DOCKER_COMPOSE_TEMPLATE = `# MonoVector PostgreSQL Testing Environment
# Official MonoVector extension from nokhodian/monovector-postgres
#
# Features:
# - 77+ SQL functions for vector operations
# - HNSW/IVFFlat indexing with SIMD acceleration
# - Hyperbolic embeddings (Poincaré ball)
# - Graph operations and GNN support
# - Agent routing and learning
#
# Performance: ~61µs latency, 16,400 QPS with HNSW

services:
  postgres:
    image: nokhodian/monovector-postgres:latest
    container_name: monovector-postgres
    environment:
      POSTGRES_USER: claude
      POSTGRES_PASSWORD: monomind-test
      POSTGRES_DB: monomind
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/01-init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U claude -d monomind"]
      interval: 5s
      timeout: 5s
      retries: 10
    command: >
      postgres
      -c work_mem=256MB
      -c maintenance_work_mem=512MB

  # Optional: pgAdmin for visual database management
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: monovector-pgadmin
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@monomind.local
      PGADMIN_DEFAULT_PASSWORD: admin
      PGADMIN_CONFIG_SERVER_MODE: 'False'
    ports:
      - "5050:80"
    depends_on:
      postgres:
        condition: service_healthy
    profiles:
      - gui

volumes:
  postgres_data:
`;
/**
 * Init SQL template for MonoVector PostgreSQL
 */
const INIT_SQL_TEMPLATE = `-- ============================================
-- MONOVECTOR POSTGRESQL INITIALIZATION SCRIPT
-- ============================================
--
-- This script initializes MonoVector PostgreSQL extension
-- from nokhodian/monovector-postgres with Monomind integration.
--
-- MonoVector provides 77+ SQL functions including:
-- - Vector similarity search (HNSW with SIMD)
-- - Hyperbolic embeddings (Poincaré/Lorentz)
-- - Graph operations (Cypher queries)
-- - Agent routing and learning
--
-- Performance: ~61µs latency, 16,400 QPS

-- ============================================
-- PART 1: EXTENSION AND SCHEMA SETUP
-- ============================================

-- IMPORTANT: MonoVector requires explicit VERSION
-- The control file says 2.0.0 but only 0.1.0 SQL exists
CREATE EXTENSION IF NOT EXISTS monovector VERSION '0.1.0';

-- Enable additional required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the monomind schema
CREATE SCHEMA IF NOT EXISTS monomind;

-- Grant permissions
GRANT ALL ON SCHEMA monomind TO claude;

-- Set search path
SET search_path TO monomind, public;

-- ============================================
-- PART 2: CORE TABLES
-- ============================================

-- Embeddings table with MonoVector vector type (384-dim for all-MiniLM-L6-v2)
CREATE TABLE IF NOT EXISTS monomind.embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding monovector(384),
    metadata JSONB DEFAULT '{}',
    namespace VARCHAR(100) DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Patterns table for learned patterns (ReasoningBank)
CREATE TABLE IF NOT EXISTS monomind.patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    embedding monovector(384),
    pattern_type VARCHAR(50),
    confidence FLOAT DEFAULT 0.5,
    success_count INT DEFAULT 0,
    failure_count INT DEFAULT 0,
    ewc_importance FLOAT DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents table for multi-agent memory coordination
CREATE TABLE IF NOT EXISTS monomind.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(255) NOT NULL UNIQUE,
    agent_type VARCHAR(50),
    state JSONB DEFAULT '{}',
    memory_embedding monovector(384),
    last_active TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trajectories table for SONA reinforcement learning
CREATE TABLE IF NOT EXISTS monomind.trajectories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trajectory_id VARCHAR(255) NOT NULL UNIQUE,
    agent_type VARCHAR(50),
    task_description TEXT,
    status VARCHAR(20) DEFAULT 'in_progress',
    steps JSONB DEFAULT '[]',
    outcome VARCHAR(20),
    quality_score FLOAT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- Memory entries table (main storage for Monomind memory)
CREATE TABLE IF NOT EXISTS monomind.memory_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    embedding monovector(384),
    namespace VARCHAR(100) DEFAULT 'default',
    metadata JSONB DEFAULT '{}',
    ttl TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(key, namespace)
);

-- Hyperbolic embeddings for hierarchical data
CREATE TABLE IF NOT EXISTS monomind.hyperbolic_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    euclidean_embedding monovector(384),
    poincare_embedding real[],  -- Array for hyperbolic operations
    curvature FLOAT DEFAULT -1.0,
    hierarchy_level INT DEFAULT 0,
    parent_id UUID REFERENCES monomind.hyperbolic_embeddings(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Graph nodes for GNN operations
CREATE TABLE IF NOT EXISTS monomind.graph_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id VARCHAR(255) NOT NULL UNIQUE,
    node_type VARCHAR(50),
    embedding monovector(384),
    features JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Graph edges for message passing
CREATE TABLE IF NOT EXISTS monomind.graph_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES monomind.graph_nodes(id),
    target_id UUID REFERENCES monomind.graph_nodes(id),
    edge_type VARCHAR(50),
    weight FLOAT DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PART 3: HNSW INDICES (150x-12,500x faster)
-- ============================================

-- HNSW index for embeddings (cosine distance)
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
ON monomind.embeddings
USING hnsw (embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 100);

-- HNSW index for patterns
CREATE INDEX IF NOT EXISTS idx_patterns_hnsw
ON monomind.patterns
USING hnsw (embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 100);

-- HNSW index for agent memory
CREATE INDEX IF NOT EXISTS idx_agents_hnsw
ON monomind.agents
USING hnsw (memory_embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for memory entries
CREATE INDEX IF NOT EXISTS idx_memory_entries_hnsw
ON monomind.memory_entries
USING hnsw (embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 100);

-- HNSW index for hyperbolic embeddings
CREATE INDEX IF NOT EXISTS idx_hyperbolic_hnsw
ON monomind.hyperbolic_embeddings
USING hnsw (euclidean_embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 100);

-- HNSW index for graph nodes
CREATE INDEX IF NOT EXISTS idx_graph_nodes_hnsw
ON monomind.graph_nodes
USING hnsw (embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Additional indices for common queries
CREATE INDEX IF NOT EXISTS idx_embeddings_namespace ON monomind.embeddings(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_entries_namespace ON monomind.memory_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_entries_key ON monomind.memory_entries(key);

-- ============================================
-- PART 4: CORE SEARCH FUNCTIONS
-- ============================================

-- Semantic similarity search using MonoVector HNSW
CREATE OR REPLACE FUNCTION monomind.search_similar(
    query_embedding monovector(384),
    limit_count INT DEFAULT 10,
    min_similarity FLOAT DEFAULT 0.5
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    similarity FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.content,
        (1 - (e.embedding <=> query_embedding))::FLOAT AS similarity,
        e.metadata
    FROM monomind.embeddings e
    WHERE e.embedding IS NOT NULL
      AND (1 - (e.embedding <=> query_embedding)) >= min_similarity
    ORDER BY e.embedding <=> query_embedding
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Memory search with namespace filtering
CREATE OR REPLACE FUNCTION monomind.search_memory(
    query_embedding monovector(384),
    namespace_filter VARCHAR(100) DEFAULT NULL,
    limit_count INT DEFAULT 10,
    min_similarity FLOAT DEFAULT 0.5
)
RETURNS TABLE (
    id UUID,
    key VARCHAR(255),
    value TEXT,
    namespace VARCHAR(100),
    similarity FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.key,
        m.value,
        m.namespace,
        (1 - (m.embedding <=> query_embedding))::FLOAT AS similarity,
        m.metadata
    FROM monomind.memory_entries m
    WHERE m.embedding IS NOT NULL
      AND (1 - (m.embedding <=> query_embedding)) >= min_similarity
      AND (namespace_filter IS NULL OR m.namespace = namespace_filter)
      AND (m.ttl IS NULL OR m.ttl > NOW())
    ORDER BY m.embedding <=> query_embedding
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Pattern search with type filtering
CREATE OR REPLACE FUNCTION monomind.search_patterns(
    query_embedding monovector(384),
    pattern_type_filter VARCHAR(50) DEFAULT NULL,
    limit_count INT DEFAULT 10,
    min_confidence FLOAT DEFAULT 0.5
)
RETURNS TABLE (
    id UUID,
    name VARCHAR(255),
    description TEXT,
    similarity FLOAT,
    confidence FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.name,
        p.description,
        (1 - (p.embedding <=> query_embedding))::FLOAT AS similarity,
        p.confidence,
        p.metadata
    FROM monomind.patterns p
    WHERE p.embedding IS NOT NULL
      AND p.confidence >= min_confidence
      AND (pattern_type_filter IS NULL OR p.pattern_type = pattern_type_filter)
    ORDER BY p.embedding <=> query_embedding
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Agent routing by expertise similarity
CREATE OR REPLACE FUNCTION monomind.find_agents(
    query_embedding monovector(384),
    agent_type_filter VARCHAR(50) DEFAULT NULL,
    limit_count INT DEFAULT 5
)
RETURNS TABLE (
    agent_id VARCHAR(255),
    agent_type VARCHAR(50),
    similarity FLOAT,
    state JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.agent_id,
        a.agent_type,
        (1 - (a.memory_embedding <=> query_embedding))::FLOAT AS similarity,
        a.state
    FROM monomind.agents a
    WHERE a.memory_embedding IS NOT NULL
      AND (agent_type_filter IS NULL OR a.agent_type = agent_type_filter)
    ORDER BY a.memory_embedding <=> query_embedding
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 5: HYPERBOLIC OPERATIONS
-- ============================================

-- Convert Euclidean to Poincaré embedding
CREATE OR REPLACE FUNCTION monomind.to_poincare(
    euclidean real[],
    curvature FLOAT DEFAULT -1.0
)
RETURNS real[] AS $$
BEGIN
    RETURN monovector_exp_map(ARRAY_FILL(0.0::real, ARRAY[array_length(euclidean, 1)]), euclidean, curvature);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Poincaré distance (geodesic)
CREATE OR REPLACE FUNCTION monomind.poincare_distance(
    x real[],
    y real[],
    curvature FLOAT DEFAULT -1.0
)
RETURNS FLOAT AS $$
BEGIN
    RETURN monovector_poincare_distance(x, y, curvature);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Hyperbolic search in Poincaré ball
CREATE OR REPLACE FUNCTION monomind.hyperbolic_search(
    query monovector(384),
    limit_count INT DEFAULT 10,
    curvature FLOAT DEFAULT -1.0
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    euclidean_dist FLOAT,
    hyperbolic_dist FLOAT,
    hierarchy_level INT,
    metadata JSONB
) AS $$
DECLARE
    query_arr real[];
    query_poincare real[];
BEGIN
    -- Convert query to array and then to Poincaré
    SELECT array_agg(x::real ORDER BY ordinality) INTO query_arr
    FROM unnest(string_to_array(trim(both '[]' from query::text), ',')) WITH ORDINALITY AS t(x, ordinality);

    query_poincare := monomind.to_poincare(query_arr, curvature);

    RETURN QUERY
    SELECT
        he.id,
        he.content,
        (he.euclidean_embedding <-> query)::FLOAT AS euc_dist,
        COALESCE(monovector_poincare_distance(he.poincare_embedding, query_poincare, curvature), 999.0)::FLOAT AS hyp_dist,
        he.hierarchy_level,
        he.metadata
    FROM monomind.hyperbolic_embeddings he
    WHERE he.euclidean_embedding IS NOT NULL
    ORDER BY he.euclidean_embedding <-> query
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 6: UTILITY FUNCTIONS
-- ============================================

-- Get MonoVector version info
CREATE OR REPLACE FUNCTION monomind.monovector_info()
RETURNS TABLE (
    version TEXT,
    simd_info TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT monovector_version(), monovector_simd_info();
END;
$$ LANGUAGE plpgsql STABLE;

-- Cosine similarity helper (converts cosine distance to similarity)
CREATE OR REPLACE FUNCTION monomind.cosine_similarity(
    a monovector,
    b monovector
)
RETURNS FLOAT AS $$
BEGIN
    RETURN (1 - (a <=> b))::FLOAT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- L2 distance helper
CREATE OR REPLACE FUNCTION monomind.l2_distance(
    a monovector,
    b monovector
)
RETURNS FLOAT AS $$
BEGIN
    RETURN (a <-> b)::FLOAT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Upsert memory entry
CREATE OR REPLACE FUNCTION monomind.upsert_memory(
    p_key VARCHAR(255),
    p_value TEXT,
    p_embedding monovector(384) DEFAULT NULL,
    p_namespace VARCHAR(100) DEFAULT 'default',
    p_metadata JSONB DEFAULT '{}',
    p_ttl TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO monomind.memory_entries (key, value, embedding, namespace, metadata, ttl, updated_at)
    VALUES (p_key, p_value, p_embedding, p_namespace, p_metadata, p_ttl, NOW())
    ON CONFLICT (key, namespace) DO UPDATE SET
        value = EXCLUDED.value,
        embedding = COALESCE(EXCLUDED.embedding, monomind.memory_entries.embedding),
        metadata = EXCLUDED.metadata,
        ttl = EXCLUDED.ttl,
        updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMPLETION
-- ============================================

DO $$
DECLARE
    v_version TEXT;
    v_simd TEXT;
BEGIN
    SELECT monovector_version() INTO v_version;
    SELECT monovector_simd_info() INTO v_simd;

    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE 'MonoVector PostgreSQL Initialization Complete!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE 'MonoVector Version: %', v_version;
    RAISE NOTICE 'SIMD: %', v_simd;
    RAISE NOTICE '';
    RAISE NOTICE 'Schema: monomind';
    RAISE NOTICE 'Tables: embeddings, patterns, agents, trajectories,';
    RAISE NOTICE '        memory_entries, hyperbolic_embeddings,';
    RAISE NOTICE '        graph_nodes, graph_edges';
    RAISE NOTICE 'Indices: 6 HNSW indices + 3 B-tree indices';
    RAISE NOTICE '';
    RAISE NOTICE 'Key Functions:';
    RAISE NOTICE '  - monomind.search_similar(embedding, limit, min_sim)';
    RAISE NOTICE '  - monomind.search_memory(embedding, namespace, limit)';
    RAISE NOTICE '  - monomind.search_patterns(embedding, type, limit)';
    RAISE NOTICE '  - monomind.find_agents(embedding, type, limit)';
    RAISE NOTICE '  - monomind.hyperbolic_search(embedding, limit, curvature)';
    RAISE NOTICE '  - monomind.upsert_memory(key, value, embedding, namespace)';
    RAISE NOTICE '';
    RAISE NOTICE 'Operators: <=> (cosine), <-> (L2), <#> (neg inner product)';
    RAISE NOTICE '';
END $$;
`;
/**
 * README template
 */
const README_TEMPLATE = `# MonoVector PostgreSQL Setup

This directory contains the Docker configuration for MonoVector PostgreSQL with Monomind.

## Quick Start

\`\`\`bash
# Start the container
docker-compose up -d

# Verify it's running
docker-compose ps

# Check MonoVector version
docker exec monovector-postgres psql -U claude -d monomind -c "SELECT monovector_version();"
\`\`\`

## Connection Details

| Setting | Value |
|---------|-------|
| Host | localhost |
| Port | 5432 |
| Database | monomind |
| Username | claude |
| Password | monomind-test |
| Schema | monomind |

## MonoVector Syntax

### Extension Installation
\`\`\`sql
-- IMPORTANT: Requires explicit version
CREATE EXTENSION IF NOT EXISTS monovector VERSION '0.1.0';
\`\`\`

### Vector Type
\`\`\`sql
-- Use monovector(384), NOT vector(384)
CREATE TABLE embeddings (
    id UUID PRIMARY KEY,
    embedding monovector(384)
);
\`\`\`

### Distance Operators
| Operator | Description |
|----------|-------------|
| \`<=>\` | Cosine distance |
| \`<->\` | L2 (Euclidean) distance |
| \`<#>\` | Negative inner product |

### HNSW Index
\`\`\`sql
CREATE INDEX idx_embeddings_hnsw
ON embeddings
USING hnsw (embedding monovector_cosine_ops)
WITH (m = 16, ef_construction = 100);
\`\`\`

## Import from sql.js/JSON

\`\`\`bash
# Export current Monomind memory
npx monomind memory list --format json > memory-export.json

# Import to MonoVector PostgreSQL
npx monomind monovector import --input memory-export.json
\`\`\`

## pgAdmin (Optional)

\`\`\`bash
docker-compose --profile gui up -d
\`\`\`

Access at: http://localhost:5050
- Email: admin@monomind.local
- Password: admin

## Troubleshooting

### Extension creation fails
Use explicit version: \`CREATE EXTENSION monovector VERSION '0.1.0';\`

### Container won't start
\`\`\`bash
docker-compose logs postgres
docker-compose down -v
docker-compose up -d
\`\`\`

## Learn More
- [MonoVector Docker Hub](https://hub.docker.com/r/nokhodian/monovector-postgres)
- [Monomind Documentation](https://github.com/nokhodian/monomind)
`;
/**
 * MonoVector Setup command - outputs Docker files and SQL
 */
export const setupCommand = {
    name: 'setup',
    description: 'Output Docker files and SQL for MonoVector PostgreSQL setup',
    aliases: ['scaffold', 'docker'],
    options: [
        {
            name: 'output',
            short: 'o',
            description: 'Output directory (default: ./monovector-postgres)',
            type: 'string',
            default: './monovector-postgres',
        },
        {
            name: 'print',
            short: 'p',
            description: 'Print to stdout instead of writing files',
            type: 'boolean',
            default: false,
        },
        {
            name: 'force',
            short: 'f',
            description: 'Overwrite existing files',
            type: 'boolean',
            default: false,
        },
    ],
    examples: [
        { command: 'monomind monovector setup', description: 'Output files to ./monovector-postgres/' },
        { command: 'monomind monovector setup --output /path/to/dir', description: 'Output to custom directory' },
        { command: 'monomind monovector setup --print', description: 'Print files to stdout' },
        { command: 'monomind monovector setup --force', description: 'Overwrite existing files' },
    ],
    action: async (ctx) => {
        const outputDir = ctx.flags.output || './monovector-postgres';
        const printOnly = ctx.flags.print;
        const force = ctx.flags.force;
        output.writeln();
        output.writeln(output.bold('MonoVector PostgreSQL Setup'));
        output.writeln(output.dim('='.repeat(50)));
        output.writeln();
        if (printOnly) {
            // Print to stdout
            output.writeln(output.bold('=== docker-compose.yml ==='));
            output.writeln();
            output.writeln(DOCKER_COMPOSE_TEMPLATE);
            output.writeln();
            output.writeln(output.bold('=== scripts/init-db.sql ==='));
            output.writeln();
            output.writeln(INIT_SQL_TEMPLATE);
            output.writeln();
            output.writeln(output.bold('=== README.md ==='));
            output.writeln();
            output.writeln(README_TEMPLATE);
            return { success: true };
        }
        // Create directory structure
        const scriptsDir = path.join(outputDir, 'scripts');
        try {
            // Check if directory exists
            if (fs.existsSync(outputDir) && !force) {
                const files = fs.readdirSync(outputDir);
                if (files.length > 0) {
                    output.printWarning(`Directory ${outputDir} already exists and is not empty.`);
                    output.printInfo('Use --force to overwrite existing files.');
                    return { success: false, message: 'Directory not empty' };
                }
            }
            // Create directories
            output.printInfo(`Creating directory: ${outputDir}`);
            fs.mkdirSync(outputDir, { recursive: true });
            fs.mkdirSync(scriptsDir, { recursive: true });
            // Write files
            const dockerComposePath = path.join(outputDir, 'docker-compose.yml');
            const initSqlPath = path.join(scriptsDir, 'init-db.sql');
            const readmePath = path.join(outputDir, 'README.md');
            output.printInfo(`Writing: ${dockerComposePath}`);
            fs.writeFileSync(dockerComposePath, DOCKER_COMPOSE_TEMPLATE);
            output.printInfo(`Writing: ${initSqlPath}`);
            fs.writeFileSync(initSqlPath, INIT_SQL_TEMPLATE);
            output.printInfo(`Writing: ${readmePath}`);
            fs.writeFileSync(readmePath, README_TEMPLATE);
            output.writeln();
            output.printSuccess('MonoVector PostgreSQL setup files created!');
            output.writeln();
            output.printBox([
                'Files created:',
                '',
                `  ${outputDir}/`,
                '  ├── docker-compose.yml',
                '  ├── README.md',
                '  └── scripts/',
                '      └── init-db.sql',
                '',
                'Next steps:',
                '',
                `  cd ${outputDir}`,
                '  docker-compose up -d',
                '  docker exec monovector-postgres psql -U claude -d monomind -c "SELECT monovector_version();"',
            ].join('\n'), 'Setup Complete');
            output.writeln();
            return { success: true };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            output.printError(`Failed to create setup files: ${errorMessage}`);
            return { success: false, message: errorMessage };
        }
    },
};
export default setupCommand;
//# sourceMappingURL=setup.js.map