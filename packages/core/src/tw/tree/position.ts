import { INode } from './node';

export interface IPositionDepth<TNode extends INode<TNode>> {
    readonly node: TNode;
    readonly offset: number;
    readonly index: number;
}

export interface IPosition<TNode extends INode<TNode>> {
    readonly depth: number;

    atDepth(depth: number): IPositionDepth<TNode>;
    atReverseDepth(reverseDepth: number): IPositionDepth<TNode>;
}

export abstract class Position<TNode extends INode<TNode>> implements IPosition<TNode> {
    constructor(protected depths: IPositionDepth<TNode>[]) {}

    get depth() {
        return this.depths.length;
    }

    atDepth(depth: number) {
        if (depth < 0 || depth >= this.depths.length) {
            throw new Error('Depth out of range.');
        }
        return this.depths[depth];
    }

    atReverseDepth(reverseDepth: number) {
        if (reverseDepth < 0 || reverseDepth >= this.depths.length) {
            throw new Error('Reverse depth out of range.');
        }
        return this.depths[this.depth - reverseDepth - 1];
    }
}
