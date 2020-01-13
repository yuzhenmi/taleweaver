import { INode } from './node';

export interface IPosition<TNode extends INode> {
    getNode(): TNode;
    getDepth(): number;
    getOffset(): number;
    setParent(parent: IPosition<TNode>): void;
    getParent(): IPosition<TNode> | null;
    setChild(child: IPosition<TNode>): void;
    getChild(): IPosition<TNode> | null;
    getRoot(): IPosition<TNode>;
    getLeaf(): IPosition<TNode>;
}

export abstract class Position<TNode extends INode> {
    protected node: TNode;
    protected depth: number;
    protected offset: number;
    protected parent: IPosition<TNode> | null = null;
    protected child: IPosition<TNode> | null = null;

    constructor(node: TNode, depth: number, offset: number) {
        this.node = node;
        this.depth = depth;
        this.offset = offset;
    }

    getNode() {
        return this.node;
    }

    getDepth() {
        return this.depth;
    }

    getOffset() {
        return this.offset;
    }

    setParent(parent: IPosition<TNode>) {
        this.parent = parent;
    }

    getParent() {
        return this.parent;
    }

    setChild(child: IPosition<TNode>) {
        this.child = child;
    }

    getChild() {
        return this.child;
    }

    getRoot(): IPosition<TNode> {
        if (this.parent) {
            return this.parent.getRoot();
        }
        return this;
    }

    getLeaf(): IPosition<TNode> {
        if (this.child) {
            return this.child.getLeaf();
        }
        return this;
    }
}
