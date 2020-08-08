import { IPosition, testPositionGreaterThan } from '../../tree/position';

export interface IMapping {
    map(position: IPosition): IPosition;
    reverse(): IMapping;
}

export interface IMappingDesc {
    from: IPosition;
    toBefore: IPosition;
    toAfter: IPosition;
}

export class Mapping implements IMapping {
    constructor(protected descs: IMappingDesc[]) {}

    map(position: IPosition) {
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

    protected internalMap(position: IPosition, from: IPosition, toBefore: IPosition, toAfter: IPosition): IPosition {
        if (!testPositionGreaterThan(position, toBefore)) {
            return position;
        }
        return [
            position[0] + toAfter[0] - toBefore[0],
            ...this.internalMap(position.slice(1), from.slice(1), toBefore.slice(1), toAfter.slice(1)),
        ];
    }
}

export const identity: IMapping = {
    map: (position: IPosition) => position,
    reverse: () => identity,
};
