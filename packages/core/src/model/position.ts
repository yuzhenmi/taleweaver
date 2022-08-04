export type Path = number[];

export interface IPoint {
    path: Path;
    offset: number;
}

export interface IRange {
    anchor: IPoint;
    head: IPoint;
}

export type IPosition = Path | IPoint;

export function arePositionsEqual(position: IPosition, otherPosition: IPosition) {
    return JSON.stringify(position) === JSON.stringify(otherPosition);
}

export function normalizePosition(position: IPosition): [Path, number | null] {
    if (Array.isArray(position)) {
        return [position, null];
    }
    return [position.path, position.offset];
}
