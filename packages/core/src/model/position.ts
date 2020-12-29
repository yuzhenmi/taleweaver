export type IPath = number[];

export interface IPoint {
    path: IPath;
    offset: number;
}

export interface IRange {
    anchor: IPoint;
    head: IPoint;
}

export type IPosition = IPath | IPoint;

export function arePositionsEqual(position: IPosition, otherPosition: IPosition) {
    return JSON.stringify(position) === JSON.stringify(otherPosition);
}

export function normalizePosition(position: IPosition): [IPath, number | null] {
    if (Array.isArray(position)) {
        return [position, null];
    }
    return [position.path, position.offset];
}
