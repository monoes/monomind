function canonicalCycle(cycle, idToPath) {
    if (cycle.length === 0)
        return [];
    let minPos = 0;
    let minPath = idToPath.get(cycle[0]) ?? '';
    for (let i = 1; i < cycle.length; i++) {
        const p = idToPath.get(cycle[i]) ?? '';
        if (p < minPath) {
            minPath = p;
            minPos = i;
        }
    }
    if (minPos === 0)
        return cycle.slice(); // already canonical — single allocation
    // Single-pass rotation without 3 intermediate arrays (2x slice + spread)
    const n = cycle.length;
    const result = new Array(n);
    for (let i = 0; i < n; i++)
        result[i] = cycle[(minPos + i) % n];
    return result;
}
function tryRecordCycle(path, idToPath, seen, cycles) {
    const canonical = canonicalCycle(path, idToPath);
    const key = canonical.join(',');
    if (seen.has(key))
        return;
    seen.add(key);
    cycles.push(canonical);
}
function dfsFindCyclesFrom(start, depthLimit, sccSet, allSuccs, succRanges, maxCycles, seen, cycles, idToPath) {
    const path = [start];
    const pathSet = new Set([start]);
    const range = succRanges.get(start) ?? [0, 0];
    const dfs = [{ succPos: range[0], succEnd: range[1] }];
    while (dfs.length > 0) {
        if (cycles.length >= maxCycles)
            return;
        const frame = dfs[dfs.length - 1];
        if (frame.succPos >= frame.succEnd) {
            dfs.pop();
            if (path.length > 1) {
                const removed = path.pop();
                pathSet.delete(removed);
            }
            continue;
        }
        const w = allSuccs[frame.succPos];
        frame.succPos++;
        if (!sccSet.has(w))
            continue;
        if (w === start && path.length >= 2 && path.length === depthLimit) {
            tryRecordCycle(path, idToPath, seen, cycles);
            continue;
        }
        if (pathSet.has(w) || path.length >= depthLimit)
            continue;
        path.push(w);
        pathSet.add(w);
        const wRange = succRanges.get(w) ?? [0, 0];
        dfs.push({ succPos: wRange[0], succEnd: wRange[1] });
    }
}
function enumerateElementaryCycles(sccNodes, allSuccs, succRanges, maxCycles, idToPath, skipTypeOnly, typeOnlyEdges) {
    const sccSet = new Set(sccNodes);
    const cycles = [];
    const seen = new Set();
    // Use slice() rather than spread to avoid the iterator allocation overhead
    const sortedNodes = sccNodes.slice().sort((a, b) => {
        const pa = idToPath.get(a) ?? '';
        const pb = idToPath.get(b) ?? '';
        return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    const maxDepth = Math.min(sccNodes.length, 12);
    for (let depthLimit = 2; depthLimit <= maxDepth; depthLimit++) {
        if (cycles.length >= maxCycles)
            break;
        for (const start of sortedNodes) {
            if (cycles.length >= maxCycles)
                break;
            dfsFindCyclesFrom(start, depthLimit, sccSet, allSuccs, succRanges, maxCycles, seen, cycles, idToPath);
        }
    }
    return cycles;
}
export function findCycles(fileIds, edges, idToPath, skipTypeOnly = false, typeOnlyEdges = new Set()) {
    const n = fileIds.length;
    if (n === 0)
        return [];
    const idIndex = new Map();
    for (let i = 0; i < fileIds.length; i++) {
        idIndex.set(fileIds[i], i);
    }
    const allSuccs = [];
    const succRanges = new Map();
    for (const id of fileIds) {
        const start = allSuccs.length;
        const seen = new Set();
        const neighbors = edges.get(id) ?? [];
        for (const neighbor of neighbors) {
            if (skipTypeOnly && typeOnlyEdges.has(`${id}→${neighbor}`))
                continue;
            if (idIndex.has(neighbor) && !seen.has(neighbor)) {
                seen.add(neighbor);
                allSuccs.push(neighbor);
            }
        }
        succRanges.set(id, [start, allSuccs.length]);
    }
    const UNDEF = 0xffffffff;
    const indices = new Array(n).fill(UNDEF);
    const lowlinks = new Array(n).fill(0);
    const onStack = new Array(n).fill(false);
    const stack = [];
    const sccs = [];
    let indexCounter = 0;
    const dfsStack = [];
    for (let startI = 0; startI < n; startI++) {
        if (indices[startI] !== UNDEF)
            continue;
        const startId = fileIds[startI];
        indices[startI] = indexCounter;
        lowlinks[startI] = indexCounter;
        indexCounter++;
        onStack[startI] = true;
        stack.push(startI);
        const startRange = succRanges.get(startId) ?? [0, 0];
        dfsStack.push({ node: startI, succPos: startRange[0], succEnd: startRange[1] });
        while (dfsStack.length > 0) {
            const frame = dfsStack[dfsStack.length - 1];
            if (frame.succPos < frame.succEnd) {
                const wId = allSuccs[frame.succPos];
                frame.succPos++;
                const wI = idIndex.get(wId);
                if (wI === undefined)
                    continue;
                if (indices[wI] === UNDEF) {
                    indices[wI] = indexCounter;
                    lowlinks[wI] = indexCounter;
                    indexCounter++;
                    onStack[wI] = true;
                    stack.push(wI);
                    const wId2 = fileIds[wI];
                    const wRange = succRanges.get(wId2) ?? [0, 0];
                    dfsStack.push({ node: wI, succPos: wRange[0], succEnd: wRange[1] });
                }
                else if (onStack[wI]) {
                    const v = frame.node;
                    if (indices[wI] < lowlinks[v]) {
                        lowlinks[v] = indices[wI];
                    }
                }
            }
            else {
                const v = frame.node;
                const vLowlink = lowlinks[v];
                const vIndex = indices[v];
                dfsStack.pop();
                if (dfsStack.length > 0) {
                    const parent = dfsStack[dfsStack.length - 1];
                    if (vLowlink < lowlinks[parent.node]) {
                        lowlinks[parent.node] = vLowlink;
                    }
                }
                if (vLowlink === vIndex) {
                    const scc = [];
                    while (true) {
                        const w = stack.pop();
                        onStack[w] = false;
                        scc.push(fileIds[w]);
                        if (w === v)
                            break;
                    }
                    if (scc.length >= 2) {
                        sccs.push(scc);
                    }
                }
            }
        }
    }
    const MAX_CYCLES_PER_SCC = 20;
    const result = [];
    const seenCycles = new Set();
    for (const scc of sccs) {
        if (scc.length === 2) {
            const pathA = idToPath.get(scc[0]) ?? '';
            const pathB = idToPath.get(scc[1]) ?? '';
            const cycle = pathA <= pathB ? [scc[0], scc[1]] : [scc[1], scc[0]];
            const key = cycle.join(',');
            if (!seenCycles.has(key)) {
                seenCycles.add(key);
                result.push(cycle);
            }
            continue;
        }
        const elementary = enumerateElementaryCycles(scc, allSuccs, succRanges, MAX_CYCLES_PER_SCC, idToPath, skipTypeOnly, typeOnlyEdges);
        for (const cycle of elementary) {
            const key = cycle.join(',');
            if (!seenCycles.has(key)) {
                seenCycles.add(key);
                result.push(cycle);
            }
        }
    }
    result.sort((a, b) => {
        if (a.length !== b.length)
            return a.length - b.length;
        const pa = idToPath.get(a[0]) ?? '';
        const pb = idToPath.get(b[0]) ?? '';
        return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    return result.map(cycle => ({
        // slice() instead of spread to avoid iterator overhead
        files: cycle.slice()
            .sort((a, b) => (idToPath.get(a) ?? '').localeCompare(idToPath.get(b) ?? ''))
            .map(id => idToPath.get(id) ?? String(id)),
        length: cycle.length,
    }));
}
/** Format cycle groups as structured text for LLM consumption. */
export function formatCycleGroups(groups) {
    if (groups.length === 0)
        return 'No import cycles detected.';
    const lines = [`Import Cycles (${groups.length} total):`];
    for (const g of groups.slice(0, 30)) {
        lines.push(`\n  Cycle (length ${g.length}):`);
        for (const f of g.files)
            lines.push(`    ${f}`);
    }
    if (groups.length > 30)
        lines.push(`\n  ... and ${groups.length - 30} more cycles`);
    return lines.join('\n');
}
//# sourceMappingURL=cycle-detection.js.map