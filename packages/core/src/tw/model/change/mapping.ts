import { IModelPosition } from '../position';

export interface IMapping {
    map(position: IModelPosition): IModelPosition;
    reverse(): IMapping;
}

export interface IMappingDesc {
    from: IModelPosition;
    toBefore: IModelPosition;
    toAfter: IModelPosition;
}

export class Mapping implements IMapping {
    constructor(protected descs: IMappingDesc[]) {}

    map(position: IModelPosition) {
        return this.descs.reduce(
            (newPosition, desc) => this.internalMap(newPosition, desc.from, desc.toBefore, desc.toAfter),
            position,
        );
    }

    reverse() {
        return new Mapping(
            this.descs.map((desc) => ({ from: desc.from, toBefore: desc.toAfter, toAfter: desc.toBefore })),
        );
    }

    protected internalMap(
        position: IModelPosition,
        from: IModelPosition,
        toBefore: IModelPosition,
        toAfter: IModelPosition,
    ): IModelPosition {
        if (!isPositionGreaterThanOrEqualTo(position, toBefore)) {
            return position;
        }
        const newPosition = [toAfter[0] + position[0] - toBefore[0]];
        if (position[0] === toBefore[0]) {
            newPosition.push(
                ...this.internalMap(position.slice(1), from.slice(1), toBefore.slice(1), toAfter.slice(1)),
            );
        } else {
            newPosition.push(...position.slice(1));
        }
        return newPosition;
    }
}

export const identity: IMapping = {
    map: (position: IModelPosition) => position,
    reverse: () => identity,
};

function isPositionGreaterThanOrEqualTo(position1: IModelPosition, position2: IModelPosition): boolean {
    if (position1.length === 0 || position2.length === 0) {
        return false;
    }
    if (position1[0] < position2[0]) {
        return false;
    }
    if (position1[0] > position2[0]) {
        return true;
    }
    if (position1.length === 1 && position2.length === 1) {
        return true;
    }
    return isPositionGreaterThanOrEqualTo(position1.slice(1), position2.slice(1));
}
