import type { RawGroup } from './extraction.js';
export interface Interval {
    start: number;
    end: number;
}
export declare class IntervalIndex {
    private intervals;
    insert(interval: Interval): void;
    contains(interval: Interval): boolean;
    overlaps(interval: Interval): boolean;
    private partitionByEnd;
    private partitionByStart;
}
export declare function filterCloneGroups(groups: RawGroup[], fileOffsets: number[], fileOf: number[], minLines: number, lineCount: (fileId: number, offset: number, length: number) => number): RawGroup[];
//# sourceMappingURL=filtering.d.ts.map