import { IPath, IPosition, normalizePosition } from '../position';

export interface IMapping {
    map<TPosition extends IPosition>(position: TPosition): TPosition;
    reverse(): IMapping;
}

export interface IMappingEntry {
    path: IPath;
    start: number;
    endBefore: number;
    endAfter: number;
}

export class Mapping implements IMapping {
    constructor(protected entries: IMappingEntry[]) {
        this.entries.forEach((entry) => this.validateEntry(entry));
    }

    map<TPosition extends IPosition>(position: TPosition): TPosition {
        return this.entries.reduce(
            (mappedPosition, entry) => this.mapEntry(mappedPosition, entry),
            position,
        );
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

    protected validateEntry(entry: IMappingEntry) {
        if (entry.endBefore < entry.start) {
            throw new Error(
                'Mapping entry ending offset (before mapping) cannot be less than starting offset.',
            );
        }
        if (entry.endAfter < entry.start) {
            throw new Error(
                'Mapping entry ending offset (after mapping) cannot be less than starting offset.',
            );
        }
    }

    protected mapEntry<TPosition extends IPosition>(
        position: TPosition,
        entry: IMappingEntry,
    ): TPosition {
        const [path, offset] = normalizePosition(position);
        const pathWithOffset = offset === null ? path : [...path, offset];
        if (pathWithOffset.length <= entry.path.length) {
            return position;
        }
        for (let n = 0; n < entry.path.length; n++) {
            if (pathWithOffset[n] !== entry.path[n]) {
                return position;
            }
        }
        if (pathWithOffset[entry.path.length] <= entry.start) {
            return position;
        }
        if (pathWithOffset[entry.path.length] < entry.endAfter) {
            throw new Error('Position cannot be mapped by this mapping.');
        }
        const delta = entry.endAfter - entry.endBefore;
        const newPathWithOffset = [
            ...pathWithOffset.slice(0, entry.path.length),
            pathWithOffset[entry.path.length] + delta,
            ...pathWithOffset.slice(entry.path.length + 1),
        ];
        return (offset === null
            ? newPathWithOffset
            : {
                  path: newPathWithOffset.slice(
                      0,
                      newPathWithOffset.length - 1,
                  ),
                  offset: newPathWithOffset[newPathWithOffset.length - 1],
              }) as TPosition;
    }
}

export const identity: IMapping = {
    map<TPosition extends IPosition>(position: TPosition) {
        return position;
    },

    reverse() {
        return identity;
    },
};
