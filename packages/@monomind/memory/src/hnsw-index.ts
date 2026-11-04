/**
 * V1 HNSW Vector Index
 *
 * Hierarchical Navigable Small World (HNSW) index for approximate
 * nearest-neighbour vector search. SqlBackend switches to it above
 * MONOMIND_HNSW_THRESHOLD (default 100,000 entries); below that, brute-force
 * cosine is used. No measured speedup figure is claimed here.
 *
 * OPTIMIZATIONS:
 * - BinaryMinHeap/BinaryMaxHeap for O(log n) operations (vs O(n log n) Array.sort)
 * - Pre-normalized vectors for O(1) cosine similarity (no sqrt needed)
 * - Bounded max-heap for efficient top-k tracking
 *
 * @module v1/memory/hnsw-index
 */

import { EventEmitter } from 'node:events';
import { distanceOptimized, normalizeVector } from './hnsw-distance.js';
import { pruneConnections, searchLayerOptimized, selectNeighbors } from './hnsw-graph-ops.js';
import { Quantizer } from './hnsw-quantizer.js';
import type { HNSWSerialized } from './hnsw-serialize.js';
import { deserializeNodes, serializeGraph } from './hnsw-serialize.js';
import type { HNSWConfig, HNSWStats } from './types.js';

export type { HNSWSerialized } from './hnsw-serialize.js';

/**
 * Internal node structure for HNSW graph
 */
export interface HNSWNode {
  /** Node ID (memory entry ID) */
  id: string;

  /** Vector embedding (original) */
  vector: Float32Array;

  /** Pre-normalized vector for O(1) cosine similarity */
  normalizedVector: Float32Array | null;

  /** Connections at each layer */
  connections: Map<number, Set<string>>;

  /** Node level (top layer this node appears in) */
  level: number;
}

/**
 * HNSW Index implementation for ultra-fast vector similarity search
 *
 * Performance characteristics:
 * - Search: O(log n) approximate nearest neighbor
 * - Insert: O(log n) amortized
 * - Memory: O(n * M * L) where M is max connections, L is layers
 */
export class HNSWIndex extends EventEmitter {
  private config: HNSWConfig;
  private nodes: Map<string, HNSWNode> = new Map();
  private entryPoint: string | null = null;
  private maxLevel: number = 0;
  private levelMult: number;

  // Performance tracking
  private stats: {
    searchCount: number;
    totalSearchTime: number;
    insertCount: number;
    totalInsertTime: number;
    buildStartTime: number;
  } = {
    searchCount: 0,
    totalSearchTime: 0,
    insertCount: 0,
    totalInsertTime: 0,
    buildStartTime: 0,
  };

  // Quantization support
  private quantizer: Quantizer | null = null;

  constructor(config: Partial<HNSWConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);
    this.levelMult = 1 / Math.log(this.config.M);

    if (this.config.quantization) {
      this.quantizer = new Quantizer(this.config.quantization, this.config.dimensions);
    }
  }

  /**
   * Add a vector to the index
   */
  async addPoint(id: string, vector: Float32Array): Promise<void> {
    const startTime = performance.now();

    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`,
      );
    }

    if (this.nodes.size >= this.config.maxElements) {
      throw new Error('Index is full, cannot add more elements');
    }

    // Quantize if enabled
    const storedVector = this.quantizer ? this.quantizer.encode(vector) : vector;

    // Pre-normalize vector for O(1) cosine similarity
    const normalizedVector = this.config.metric === 'cosine' ? normalizeVector(storedVector) : null;

    // Generate random level for new node
    const level = this.getRandomLevel();

    const node: HNSWNode = {
      id,
      vector: storedVector,
      normalizedVector,
      connections: new Map(),
      level,
    };

    // Initialize connection sets for each layer
    for (let l = 0; l <= level; l++) {
      node.connections.set(l, new Set());
    }

    if (this.entryPoint === null) {
      // First node
      this.entryPoint = id;
      this.maxLevel = level;
      this.nodes.set(id, node);
    } else {
      // Insert new node into the graph
      await this.insertNode(node);
    }

    const duration = performance.now() - startTime;
    this.stats.insertCount++;
    this.stats.totalInsertTime += duration;

    this.emit('point:added', { id, level, duration });
  }

  /**
   * Search for k nearest neighbors
   */
  async search(
    query: Float32Array,
    k: number,
    ef?: number,
  ): Promise<Array<{ id: string; distance: number }>> {
    const startTime = performance.now();

    if (query.length !== this.config.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.config.dimensions}, got ${query.length}`,
      );
    }

    if (this.entryPoint === null) {
      return [];
    }

    const searchEf = ef || Math.max(k, this.config.efConstruction);

    // Quantize query if needed
    const queryVector = this.quantizer ? this.quantizer.encode(query) : query;

    // Pre-normalize query for O(1) cosine similarity
    const normalizedQuery = this.config.metric === 'cosine' ? normalizeVector(queryVector) : null;

    // Start from entry point and search down the layers
    let currentNode = this.entryPoint;

    // Search through layers from top to 1
    for (let level = this.maxLevel; level > 0; level--) {
      const layerResult = searchLayerOptimized(
        this.nodes,
        this.config.metric,
        queryVector,
        normalizedQuery,
        currentNode,
        1,
        level,
      );
      currentNode = layerResult[0]?.id || currentNode;
    }

    // Search layer 0 with ef candidates using heap-based search
    const candidates = searchLayerOptimized(
      this.nodes,
      this.config.metric,
      queryVector,
      normalizedQuery,
      currentNode,
      searchEf,
      0,
    );

    // Return top k results (already sorted by heap)
    const results = candidates.slice(0, k);

    const duration = performance.now() - startTime;
    this.stats.searchCount++;
    this.stats.totalSearchTime += duration;

    return results;
  }

  /**
   * Search with filters applied post-retrieval
   */
  async searchWithFilters(
    query: Float32Array,
    k: number,
    filter: (id: string) => boolean,
    ef?: number,
  ): Promise<Array<{ id: string; distance: number }>> {
    // Over-fetch to account for filtered results
    const overFetchFactor = 3;
    const candidates = await this.search(query, k * overFetchFactor, ef);

    return candidates.filter((c) => filter(c.id)).slice(0, k);
  }

  /**
   * Remove a point from the index
   */
  async removePoint(id: string): Promise<boolean> {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    // Remove all connections to this node
    for (let level = 0; level <= node.level; level++) {
      const connections = node.connections.get(level);
      if (connections) {
        for (const connectedId of connections) {
          const connectedNode = this.nodes.get(connectedId);
          if (connectedNode) {
            connectedNode.connections.get(level)?.delete(id);
          }
        }
      }
    }

    this.nodes.delete(id);

    // Update entry point if needed
    if (this.entryPoint === id) {
      if (this.nodes.size === 0) {
        this.entryPoint = null;
        this.maxLevel = 0;
      } else {
        // Find new entry point with highest level
        let newEntry: string | null = null;
        let newMaxLevel = 0;
        for (const [nodeId, n] of this.nodes) {
          if (newEntry === null || n.level > newMaxLevel) {
            newMaxLevel = n.level;
            newEntry = nodeId;
          }
        }
        this.entryPoint = newEntry;
        this.maxLevel = newMaxLevel;
      }
    }

    this.emit('point:removed', { id });
    return true;
  }

  /**
   * Rebuild the index from scratch
   */
  async rebuild(entries: Array<{ id: string; vector: Float32Array }>): Promise<void> {
    this.stats.buildStartTime = performance.now();

    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;

    for (const entry of entries) {
      await this.addPoint(entry.id, entry.vector);
    }

    const buildTime = performance.now() - this.stats.buildStartTime;

    this.emit('index:rebuilt', {
      vectorCount: this.nodes.size,
      buildTime,
    });
  }

  /**
   * Serialize the built graph (config, entry point, and every node's vector +
   * per-level connections) so a caller can persist it to disk and reconstruct
   * an identical index later without re-inserting every point. Vectors are
   * base64-encoded Float32 bytes rather than JSON number arrays to keep the
   * serialized size and parse cost down for large indexes.
   *
   * Not supported for quantized indexes (quantizer state isn't captured) —
   * throws rather than silently producing a graph that would deserialize
   * with the wrong vector encoding.
   */
  serialize(): HNSWSerialized {
    if (this.quantizer) {
      throw new Error('HNSWIndex.serialize() does not support quantized indexes');
    }
    return serializeGraph(this.nodes, this.config, this.entryPoint, this.maxLevel);
  }

  /** Reconstruct an index previously produced by serialize(). */
  static deserialize(data: HNSWSerialized): HNSWIndex {
    if (data.version !== 1) {
      throw new Error(`HNSWIndex.deserialize: unsupported version ${data.version}`);
    }
    const index = new HNSWIndex(data.config);
    index.nodes = deserializeNodes(data);
    index.entryPoint = data.entryPoint;
    index.maxLevel = data.maxLevel;
    return index;
  }

  /**
   * Get index statistics
   */
  getStats(): HNSWStats {
    const vectorCount = this.nodes.size;
    const avgSearchTime =
      this.stats.searchCount > 0 ? this.stats.totalSearchTime / this.stats.searchCount : 0;

    // Estimate memory usage
    const bytesPerVector = this.config.dimensions * 4; // Float32 = 4 bytes
    const connectionOverhead = this.config.M * 8 * (this.maxLevel + 1); // Approximate
    const memoryUsage = vectorCount * (bytesPerVector + connectionOverhead);

    return {
      vectorCount,
      memoryUsage,
      avgSearchTime,
      buildTime: performance.now() - this.stats.buildStartTime,
      compressionRatio: this.quantizer?.getCompressionRatio() || 1.0,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;
    this.stats = {
      searchCount: 0,
      totalSearchTime: 0,
      insertCount: 0,
      totalInsertTime: 0,
      buildStartTime: 0,
    };
  }

  /**
   * Check if an ID exists in the index
   */
  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Get the number of vectors in the index
   */
  get size(): number {
    return this.nodes.size;
  }

  // ===== Private Methods =====

  private mergeConfig(config: Partial<HNSWConfig>): HNSWConfig {
    return {
      dimensions: config.dimensions || 1536, // OpenAI embedding size
      M: config.M || 16,
      efConstruction: config.efConstruction || 200,
      maxElements: config.maxElements || 1000000,
      metric: config.metric || 'cosine',
      quantization: config.quantization,
    };
  }

  private getRandomLevel(): number {
    // Malkov & Yashunin (2018): level = floor(-ln(uniform(0,1)) * mL)
    // where mL = 1/ln(M) (already stored as this.levelMult)
    return Math.floor(-Math.log(Math.random()) * this.levelMult);
  }

  private async insertNode(node: HNSWNode): Promise<void> {
    const query = node.vector;
    const normalizedQuery = node.normalizedVector;
    let currentNode = this.entryPoint!;
    let currentDist = distanceOptimized(
      this.config.metric,
      query,
      normalizedQuery,
      this.nodes.get(currentNode)!,
    );

    // Find entry point for the node's level
    for (let level = this.maxLevel; level > node.level; level--) {
      const result = searchLayerOptimized(
        this.nodes,
        this.config.metric,
        query,
        normalizedQuery,
        currentNode,
        1,
        level,
      );
      if (result.length > 0 && result[0].distance < currentDist) {
        currentNode = result[0].id;
        currentDist = result[0].distance;
      }
    }

    // Insert at each level from node.level down to 0
    for (let level = Math.min(node.level, this.maxLevel); level >= 0; level--) {
      const neighbors = searchLayerOptimized(
        this.nodes,
        this.config.metric,
        query,
        normalizedQuery,
        currentNode,
        this.config.efConstruction,
        level,
      );

      // Select M best neighbors
      const selectedNeighbors = selectNeighbors(node.id, query, neighbors, this.config.M);

      // Add connections
      for (const neighbor of selectedNeighbors) {
        node.connections.get(level)?.add(neighbor.id);
        this.nodes.get(neighbor.id)?.connections.get(level)?.add(node.id);

        // Prune connections if over limit
        const neighborNode = this.nodes.get(neighbor.id);
        if (neighborNode) {
          const neighborConns = neighborNode.connections.get(level)!;
          const maxConns = level === 0 ? this.config.M * 2 : this.config.M;
          if (neighborConns.size > maxConns) {
            pruneConnections(this.nodes, this.config.metric, neighborNode, level, maxConns);
          }
        }
      }

      if (neighbors.length > 0) {
        currentNode = neighbors[0].id;
      }
    }

    this.nodes.set(node.id, node);

    // Update max level if needed
    if (node.level > this.maxLevel) {
      this.maxLevel = node.level;
      this.entryPoint = node.id;
    }
  }
}

export default HNSWIndex;
