import { AnyNode } from './Node';

export default class Position<N extends AnyNode> {
    protected node: N;
    protected depth: number;
    protected offset: number;
    protected parent: Position<N> | null = null;
    protected child: Position<N> | null = null;

    constructor(node: N, depth: number, offset: number) {
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

    setParent(parent: Position<N>) {
        this.parent = parent;
    }

    getParent() {
        return this.parent;
    }

    setChild(child: Position<N>) {
        this.child = child;
    }

    getChild() {
        return this.child;
    }

    getLeaf(): Position<N> {
        if (this.child) {
            return this.child.getLeaf();
        }
        return this;
    }
}
