import { Path } from '../path';

/**
 * A mapping of positions between two trees before and after an operation.
 */
export interface MappingEntry {
    path: Path;
    start: number;
    endBefore: number;
    endAfter: number;
}

/**
 * A mapping of positions between two trees before and after a transformation.
 */
export class Mapping {
    constructor(protected entries: MappingEntry[]) {
        entries.forEach((entry) => this.validateEntry(entry));
    }

    map(position: Path): Path {
        return this.entries.reduce((mappedPoint, entry) => this.mapWithEntry(mappedPoint, entry), position);
    }

    reverse() {
        return new Mapping(
            this.entries.map((entry) => ({
                path: entry.path,
                start: entry.start,
                endBefore: entry.endAfter,
                endAfter: entry.endBefore,
            })),
        );
    }

    protected validateEntry(entry: MappingEntry) {
        if (entry.endBefore < entry.start || entry.endAfter < entry.start) {
            throw new Error('Invalid mapping entry.');
        }
    }

    protected mapWithEntry(path: Path, entry: MappingEntry): Path {
        if (path.length - 1 < entry.path.length) {
            return path;
        }
        for (let n = 0; n < entry.path.length; n++) {
            if (path[n] !== entry.path[n]) {
                return path;
            }
        }
        if (path[entry.path.length] <= entry.start) {
            return path;
        }
        if (path[entry.path.length] < entry.endBefore) {
            return [...path.slice(0, entry.path.length), entry.endAfter, ...path.slice(entry.path.length + 1)];
        }
        return [
            ...path.slice(0, entry.path.length),
            path[entry.path.length] - entry.endBefore + entry.endAfter,
            ...path.slice(entry.path.length + 1),
        ];
    }
}

/**
 * A mapping that does not change positions.
 */
export const identity = new Mapping([]);
