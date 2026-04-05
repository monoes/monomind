/**
 * Ledger Persistence Layer
 *
 * Connects the in-memory RunLedger to durable file-based storage using
 * newline-delimited JSON (NDJSON). Provides append-only event logging,
 * compaction, and lock-based concurrent access prevention.
 *
 * Storage layout:
 *   {storagePath}/events.ndjson  - Newline-delimited JSON events
 *   {storagePath}/index.json     - Metadata index (counts, timestamps, task IDs)
 *   {storagePath}/.lock          - Lock file for concurrent access prevention
 *
 * @module @monobrain/guidance/persistence
 */
import { RunLedger } from './ledger.js';
import type { RunEvent } from './types.js';
/**
 * Configuration for the persistent ledger
 */
export interface PersistenceConfig {
    /** Directory path for storage files (default: '.monobrain/guidance') */
    storagePath: string;
    /** Maximum events to keep; oldest evicted on compact (default: 10000) */
    maxEvents: number;
    /** How often to compact/vacuum in milliseconds (default: 1 hour) */
    compactIntervalMs: number;
    /** Enable write-ahead logging style (flush after each write) (default: true) */
    enableWAL: boolean;
}
/**
 * Storage statistics
 */
export interface StorageStats {
    /** Total number of stored events */
    eventCount: number;
    /** Storage size in bytes */
    storageSizeBytes: number;
    /** Timestamp of the oldest event (null if empty) */
    oldestEvent: number | null;
    /** Timestamp of the newest event (null if empty) */
    newestEvent: number | null;
}
/**
 * Low-level NDJSON-based event storage.
 *
 * Handles file I/O, append-only writes, range reads, compaction,
 * and lock-based concurrent access prevention.
 */
export declare class EventStore {
    private readonly eventsPath;
    private readonly indexPath;
    private readonly lockPath;
    private readonly baseDir;
    private lockHolder;
    constructor(storagePath: string);
    /**
     * Append a single event to the NDJSON file and update the index.
     */
    append(event: RunEvent): Promise<void>;
    /**
     * Read and parse all events from storage.
     */
    readAll(): Promise<RunEvent[]>;
    /**
     * Read events within a time range [startTime, endTime].
     */
    readRange(startTime: number, endTime: number): Promise<RunEvent[]>;
    /**
     * Compact the event store to keep at most `maxEvents` events.
     * Oldest events are evicted first. Rewrites the NDJSON file atomically.
     *
     * @returns The number of evicted events.
     */
    compact(maxEvents: number): Promise<number>;
    /**
     * Atomically replace all events in storage with the given array.
     * Rewrites the NDJSON file and rebuilds the index.
     */
    writeAll(events: RunEvent[]): Promise<void>;
    /**
     * Get storage statistics.
     */
    getStats(): Promise<StorageStats>;
    /**
     * Acquire a file-based lock for concurrent access prevention.
     * Throws if the lock is already held by another process.
     */
    acquireLock(): Promise<void>;
    /**
     * Release the file-based lock.
     */
    releaseLock(): Promise<void>;
    /**
     * Remove all storage files (events, index, lock).
     */
    destroy(): Promise<void>;
    /**
     * Ensure the storage directory exists.
     */
    private ensureDirectory;
    /**
     * Parse an NDJSON string into RunEvent array, skipping blank/invalid lines.
     */
    private parseNdjson;
    /**
     * Read the index file, returning a default if it does not exist.
     */
    private readIndex;
    /**
     * Update the index with a new event.
     */
    private updateIndex;
    /**
     * Rebuild the index from a given set of events.
     */
    private rebuildIndex;
}
/**
 * A RunLedger subclass that persists events to NDJSON file storage.
 *
 * Extends the in-memory RunLedger with:
 * - Automatic persistence on logEvent()
 * - Load from storage on init via importEvents()
 * - Explicit save()/load() for bulk operations
 * - Compaction to enforce maxEvents limit
 * - Storage statistics
 * - Automatic periodic compaction via interval timer
 */
export declare class PersistentLedger extends RunLedger {
    private readonly config;
    private readonly store;
    private compactTimer;
    private initialized;
    constructor(config?: Partial<PersistenceConfig>);
    /**
     * Initialize the persistent ledger: load existing events from storage
     * and start the compaction timer.
     */
    init(): Promise<void>;
    /**
     * Override logEvent to also persist the event to storage.
     */
    logEvent(event: RunEvent | Omit<RunEvent, 'eventId'>): RunEvent;
    /**
     * Override importEvents to also persist imported events to storage.
     */
    importEvents(events: RunEvent[]): void;
    /**
     * Flush all in-memory events to storage, replacing the storage contents.
     * This performs a full atomic rewrite of the NDJSON file.
     */
    save(): Promise<void>;
    /**
     * Restore events from storage into memory.
     * Clears the in-memory ledger first, then loads all stored events.
     */
    load(): Promise<void>;
    /**
     * Compact the storage to keep at most maxEvents events.
     * Also updates the in-memory ledger to match.
     *
     * @returns The number of evicted events.
     */
    compact(): Promise<number>;
    /**
     * Get storage statistics.
     */
    getStorageStats(): Promise<StorageStats>;
    /**
     * Clean up resources (stop compaction timer, release locks, etc.).
     */
    destroy(): Promise<void>;
    /**
     * Get the underlying EventStore (for advanced use / testing).
     */
    getEventStore(): EventStore;
    private startCompactTimer;
    private stopCompactTimer;
}
/**
 * Create a PersistentLedger instance. Call `init()` after creation to load
 * existing events from storage.
 */
export declare function createPersistentLedger(config?: Partial<PersistenceConfig>): PersistentLedger;
/**
 * Create an EventStore instance for direct low-level storage access.
 */
export declare function createEventStore(path: string): EventStore;
//# sourceMappingURL=persistence.d.ts.map