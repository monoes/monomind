/* tslint:disable */
/* eslint-disable */

/**
 * Create a demonstration of all three exotic mechanisms working together
 */
export class ExoticEcosystem {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get current cell count (from morphogenetic network)
     */
    cellCount(): number;
    /**
     * Crystallize the time crystal
     */
    crystallize(): void;
    /**
     * Get current step
     */
    currentStep(): number;
    /**
     * Execute a proposal
     */
    execute(proposal_id: string): boolean;
    /**
     * Get current member count (from NAO)
     */
    memberCount(): number;
    /**
     * Create a new exotic ecosystem with interconnected mechanisms
     */
    constructor(agents: number, grid_size: number, oscillators: number);
    /**
     * Propose an action in the NAO
     */
    propose(action: string): string;
    /**
     * Advance all systems by one step
     */
    step(): void;
    /**
     * Get ecosystem summary as JSON
     */
    summaryJson(): any;
    /**
     * Get current synchronization level (from time crystal)
     */
    synchronization(): number;
    /**
     * Vote on a proposal
     */
    vote(proposal_id: string, agent_id: string, weight: number): boolean;
}

/**
 * WASM-bindgen wrapper for MorphogeneticNetwork
 */
export class WasmMorphogeneticNetwork {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a growth factor source
     */
    addGrowthSource(x: number, y: number, name: string, concentration: number): void;
    /**
     * Get cell count
     */
    cellCount(): number;
    /**
     * Get all cells as JSON
     */
    cellsJson(): any;
    /**
     * Get compute cell count
     */
    computeCount(): number;
    /**
     * Get current tick
     */
    currentTick(): number;
    /**
     * Differentiate stem cells
     */
    differentiate(): void;
    /**
     * Grow the network
     */
    grow(dt: number): void;
    /**
     * Create a new morphogenetic network
     */
    constructor(width: number, height: number);
    /**
     * Prune weak connections and dead cells
     */
    prune(threshold: number): void;
    /**
     * Seed a signaling cell at position
     */
    seedSignaling(x: number, y: number): number;
    /**
     * Seed a stem cell at position
     */
    seedStem(x: number, y: number): number;
    /**
     * Get signaling cell count
     */
    signalingCount(): number;
    /**
     * Get statistics as JSON
     */
    statsJson(): any;
    /**
     * Get stem cell count
     */
    stemCount(): number;
}

/**
 * WASM-bindgen wrapper for NeuralAutonomousOrg
 */
export class WasmNAO {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get active proposal count
     */
    activeProposalCount(): number;
    /**
     * Add a member agent with initial stake
     */
    addMember(agent_id: string, stake: number): void;
    /**
     * Get coherence between two agents (0-1)
     */
    agentCoherence(agent_a: string, agent_b: string): number;
    /**
     * Get current tick
     */
    currentTick(): number;
    /**
     * Execute a proposal if consensus reached
     */
    execute(proposal_id: string): boolean;
    /**
     * Get member count
     */
    memberCount(): number;
    /**
     * Create a new NAO with the given quorum threshold (0.0 - 1.0)
     */
    constructor(quorum_threshold: number);
    /**
     * Create a new proposal, returns proposal ID
     */
    propose(action: string): string;
    /**
     * Remove a member agent
     */
    removeMember(agent_id: string): void;
    /**
     * Get current synchronization level (0-1)
     */
    synchronization(): number;
    /**
     * Advance simulation by one tick
     */
    tick(dt: number): void;
    /**
     * Get all data as JSON
     */
    toJson(): any;
    /**
     * Get total voting power
     */
    totalVotingPower(): number;
    /**
     * Vote on a proposal
     */
    vote(proposal_id: string, agent_id: string, weight: number): boolean;
}

/**
 * WASM-bindgen wrapper for TimeCrystal
 */
export class WasmTimeCrystal {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get collective spin
     */
    collectiveSpin(): number;
    /**
     * Crystallize to establish periodic order
     */
    crystallize(): void;
    /**
     * Get current step
     */
    currentStep(): number;
    /**
     * Check if crystallized
     */
    isCrystallized(): boolean;
    /**
     * Create a new time crystal with n oscillators
     */
    constructor(n: number, period_ms: number);
    /**
     * Get order parameter (synchronization level)
     */
    orderParameter(): number;
    /**
     * Get number of oscillators
     */
    oscillatorCount(): number;
    /**
     * Get current pattern type as string
     */
    patternType(): string;
    /**
     * Get period in milliseconds
     */
    periodMs(): number;
    /**
     * Apply perturbation
     */
    perturb(strength: number): void;
    /**
     * Get phases as JSON array
     */
    phasesJson(): any;
    /**
     * Get robustness measure
     */
    robustness(): number;
    /**
     * Set coupling strength
     */
    setCoupling(coupling: number): void;
    /**
     * Set disorder level
     */
    setDisorder(disorder: number): void;
    /**
     * Set driving strength
     */
    setDriving(strength: number): void;
    /**
     * Get signals as JSON array
     */
    signalsJson(): any;
    /**
     * Create a synchronized crystal
     */
    static synchronized(n: number, period_ms: number): WasmTimeCrystal;
    /**
     * Advance one tick, returns coordination pattern as Uint8Array
     */
    tick(): Uint8Array;
}

/**
 * Get information about available exotic mechanisms
 */
export function available_mechanisms(): any;

/**
 * Initialize the WASM module with panic hook
 */
export function init(): void;

/**
 * Get the version of the ruvector-exotic-wasm crate
 */
export function version(): string;
