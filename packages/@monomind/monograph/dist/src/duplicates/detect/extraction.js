export function extractCloneGroups(sa, lcp, fileOf, fileOffsets, minTokens, focusFileIds) {
    const n = sa.length;
    if (n < 2)
        return [];
    const focusPrefix = focusFileIds !== undefined ? buildFocusPrefix(sa, fileOf, focusFileIds) : null;
    const stack = [];
    const groups = [];
    for (let i = 1; i <= n; i++) {
        const curLcp = i < n ? lcp[i] : 0;
        let start = i;
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (top.lcpVal <= curLcp)
                break;
            stack.pop();
            start = top.start;
            if (top.lcpVal >= minTokens) {
                const intervalBegin = start - 1;
                const intervalEnd = i;
                if (focusPrefix !== null && !intervalHasFocus(focusPrefix, intervalBegin, intervalEnd)) {
                    continue;
                }
                const group = buildRawGroup(sa, fileOf, fileOffsets, intervalBegin, intervalEnd, top.lcpVal);
                if (group !== null)
                    groups.push(group);
            }
        }
        if (i < n) {
            stack.push({ lcpVal: curLcp, start });
        }
    }
    return groups;
}
function buildFocusPrefix(sa, fileOf, focusFileIds) {
    const prefix = new Array(sa.length + 1).fill(0);
    for (let i = 0; i < sa.length; i++) {
        const pos = sa[i];
        const fid = fileOf[pos];
        const focused = fid !== -1 && focusFileIds.has(fid) ? 1 : 0;
        prefix[i + 1] = prefix[i] + focused;
    }
    return prefix;
}
function intervalHasFocus(focusPrefix, begin, end) {
    return focusPrefix[end] > focusPrefix[begin];
}
function buildRawGroup(sa, fileOf, fileOffsets, intervalBegin, intervalEnd, length) {
    const instances = [];
    for (let idx = intervalBegin; idx < intervalEnd; idx++) {
        const pos = sa[idx];
        const fid = fileOf[pos];
        if (fid === -1)
            continue;
        const offset = pos - fileOffsets[fid];
        instances.push({ fileId: fid, offset });
    }
    if (instances.length < 2)
        return null;
    instances.sort((a, b) => a.fileId !== b.fileId ? a.fileId - b.fileId : a.offset - b.offset);
    const deduped = [];
    for (const inst of instances) {
        const last = deduped[deduped.length - 1];
        if (last !== undefined && inst.fileId === last.fileId && inst.offset < last.offset + length) {
            continue;
        }
        deduped.push(inst);
    }
    if (deduped.length < 2)
        return null;
    return { instances: deduped, lcpLength: length };
}
//# sourceMappingURL=extraction.js.map