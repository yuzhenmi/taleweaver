import { Point } from '../nodes/base';

export interface MappingEntry {
    start: Point;
    endBefore: number;
    endAfter: number;
}

export class Mapping {
    constructor(protected entries: MappingEntry[]) {
        this.entries.forEach((entry) => this.validateEntry(entry));
    }

    map(point: Point): Point {
        return this.entries.reduce((mappedPoint, entry) => this.mapEntry(mappedPoint, entry), point);
    }

    reverse() {
        return new Mapping(
            this.entries.map((entry) => ({
                start: entry.start,
                endBefore: entry.endAfter,
                endAfter: entry.endBefore,
            })),
        );
    }

    protected validateEntry(entry: MappingEntry) {
        if (entry.endBefore < entry.start.offset) {
            throw new Error('Mapping entry ending offset (before mapping) cannot be less than starting offset.');
        }
        if (entry.endAfter < entry.start.offset) {
            throw new Error('Mapping entry ending offset (after mapping) cannot be less than starting offset.');
        }
    }

    protected mapEntry(point: Point, entry: MappingEntry): Point {
        if (point.path.length < entry.start.path.length) {
            return point;
        }
        for (let n = 0; n < entry.start.path.length; n++) {
            if (point.path[n] !== entry.start.path[n]) {
                return point;
            }
        }
        if (point.path.length === entry.start.path.length) {
            if (point.offset <= entry.start.offset) {
                return point;
            }
            if (point.offset <= entry.endBefore) {
                return { path: point.path, offset: entry.endAfter };
            }
            return { path: point.path, offset: point.offset - entry.endBefore + entry.endAfter };
        }
        const pathIndex = entry.start.path.length - 1;
        if (point.path[pathIndex] <= entry.start.offset) {
            return point;
        }
        if (point.path[pathIndex] <= entry.endBefore) {
            return {
                path: [...point.path.slice(0, pathIndex), entry.endAfter, ...point.path.slice(pathIndex + 1)],
                offset: point.offset,
            };
        }
        return {
            path: [
                ...point.path.slice(0, pathIndex),
                point.path[pathIndex] - entry.endBefore + entry.endAfter,
                ...point.path.slice(pathIndex + 1),
            ],
            offset: point.offset,
        };
    }
}

export const identity = new Mapping([]);
