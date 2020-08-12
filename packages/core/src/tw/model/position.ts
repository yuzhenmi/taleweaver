import { IModelNode } from './node';

export type IPosition = number[];

export interface IResolvedOffset {
    offset: number;
    node: IModelNode<any>;
}

export type IResolvedPosition = IResolvedOffset[];

export function testPositionLessThan(position1: IPosition, position2: IPosition): boolean {
    if (position1.length === 0 || position2.length === 0) {
        return false;
    }
    if (position1[0] < position2[0]) {
        return true;
    }
    if (position1.length === 1 || position2.length === 1) {
        return false;
    }
    return testPositionLessThan(position1.slice(1), position2.slice(1));
}

export function testPositionGreaterThan(position1: IPosition, position2: IPosition): boolean {
    if (position1.length === 0 || position2.length === 0) {
        return false;
    }
    if (position1[0] > position2[0]) {
        return true;
    }
    if (position1.length === 1 || position2.length === 1) {
        return false;
    }
    return testPositionGreaterThan(position1.slice(1), position2.slice(1));
}
