import { INode } from './node';

export interface IPosition<TNode extends INode<TNode>> {
    readonly node: TNode;
    readonly depth: number;
    readonly offset: number;
    readonly parent: IPosition<TNode> | null;
    readonly child: IPosition<TNode> | null;
    readonly root: IPosition<TNode>;
    readonly leaf: IPosition<TNode>;
}

export abstract class Position<TNode extends INode<TNode>> implements IPosition<TNode> {
    readonly child: IPosition<TNode> | null;

    constructor(
        readonly node: TNode,
        readonly depth: number,
        readonly offset: number,
        readonly parent: IPosition<TNode> | null,
        buildChild: (parent: IPosition<TNode>) => IPosition<TNode> | null,
    ) {
        this.child = buildChild(this);
    }

    get root(): IPosition<TNode> {
        if (!this.parent) {
            return this;
        }
        return this.parent.root;
    }

    get leaf(): IPosition<TNode> {
        if (!this.child) {
            return this;
        }
        return this.child.leaf;
    }
}
