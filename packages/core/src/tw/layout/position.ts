import { IRenderPosition } from '../render/position';
import { ILayoutNode } from './node';

export interface IResolvedLayoutOffset {
    node: ILayoutNode;
    offset: number;
    position: IRenderPosition;
}

export type IResolvedLayoutPosition = IResolvedLayoutOffset[];

export function atLine(position: IResolvedLayoutPosition) {
    for (let n = position.length - 1; n >= 0; n--) {
        if (position[n].node.type === 'line') {
            return position[n];
        }
    }
    throw new Error('No line found.');
}

export function atWord(position: IResolvedLayoutPosition) {
    for (let n = position.length - 1; n >= 0; n--) {
        if (position[n].node.type === 'word') {
            return position[n];
        }
    }
    throw new Error('No word found.');
}

export function atBlock(position: IResolvedLayoutPosition) {
    for (let n = position.length - 1; n >= 0; n--) {
        if (position[n].node.type === 'block') {
            return position[n];
        }
    }
    throw new Error('No block found.');
}
