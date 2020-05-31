import { Fragment, IFragment } from './fragment';
import { IModelNode } from './node';
import { IModelRoot } from './root';

export interface IChange {
    apply(root: IModelRoot<any>): IChangeResult;
}

export interface IChangeResult {
    readonly change: IChange;
    readonly reverseChange: IChange;
}

export class Replace implements IChange {
    constructor(readonly from: number, readonly to: number, readonly fragments: IFragment[]) {
        this.validateInput();
    }

    apply(root: IModelRoot<any>): IChangeResult {
        this.validateFit(root);
        const removedFragments = new Remover(root, this.from, this.to).run();
        new Inserter(root, this.from, this.fragments).run();
        return {
            change: this,
            reverseChange: new Replace(
                this.from,
                // TODO: Take depths into account when determining fragments size
                this.from + this.fragments.reduce((size, fragment) => size + fragment.size, 0),
                removedFragments,
            ),
        };
    }

    protected validateInput() {
        // Validate range is valid
        if (this.from > this.to) {
            throw new Error('Range is invalid.');
        }
        // Validate fragments depths are valid
        if (this.fragments.length > 0) {
            let ascending = true;
            let descending = false;
            let depth = this.fragments[0].depth;
            for (let n = 1, nn = this.fragments.length; n < nn; n++) {
                const fragment = this.fragments[n];
                if (fragment.depth > depth) {
                    if (!ascending) {
                        throw new Error('Fragments have invalid depths.');
                    }
                } else if (fragment.depth < depth) {
                    if (ascending) {
                        ascending = false;
                        descending = true;
                    }
                    if (!descending) {
                        throw new Error('Fragments have invalid depths.');
                    }
                }
                depth = fragment.depth;
            }
        }
    }

    protected validateFit(root: IModelRoot<any>) {
        // Fragments depths must be less than depth at from position
        const fromPosition = root.resolvePosition(this.from);
        const maxFragmentDepth = Math.max(...this.fragments.map((fragment) => fragment.depth));
        if (maxFragmentDepth >= fromPosition.depth) {
            throw new Error('Fragments do not fit in range.');
        }
    }
}

class Remover {
    readonly removedFragments: IFragment[] = [];

    protected ran = false;
    protected currentOffset: number;
    protected currentNode: { node: IModelNode<any>; offset: number; depth: number } | null;

    constructor(protected root: IModelRoot<any>, protected from: number, protected to: number) {
        const fromPosition = root.resolvePosition(this.from);
        const fromPositionLastDepth = fromPosition.atDepth(fromPosition.depth - 1);
        this.currentOffset = from;
        this.currentNode = {
            node: fromPositionLastDepth.node,
            offset: fromPositionLastDepth.offset,
            depth: 0,
        };
    }

    run() {
        if (this.ran) {
            throw new Error('Remover can only be run once.');
        }
        while (this.currentNode) {
            this.step();
        }
        this.ran = true;
        return this.removedFragments;
    }

    protected step() {
        if (!this.currentNode) {
            return;
        }

        if (this.currentOffset >= this.to) {
            // End reached, break
            this.currentNode = null;
            return;
        }

        const currentNodeFrom = this.currentOffset - this.currentNode.offset;
        const currentNodeTo = currentNodeFrom + this.currentNode.node.size;

        if (currentNodeFrom === this.from && currentNodeTo <= this.to) {
            // Node should be fully removed, delegate to parent
            this.currentNode = {
                node: this.currentNode.node.parent!,
                offset: getNodeOffsetRelativeToParent(this.currentNode.node),
                depth: this.currentNode.depth + 1,
            };
            return;
        }

        if (currentNodeTo > this.from) {
            // Part of this node should be removed
            if (this.currentNode.node.leaf) {
                // Remove text
                const removeFrom = this.from - currentNodeFrom;
                const removeTo = Math.min(this.to - currentNodeFrom, this.currentNode.node.size);
                this.removedFragments.push(new Fragment(this.currentNode.node.text.slice(removeFrom, removeTo), 0));
                this.currentNode.node.replace(removeFrom, removeTo, '');
            } else {
                // Remove full nodes, delegate partial removal
                let offset = this.currentOffset;
                let removeFrom = this.currentNode.node.children.length;
                let removeTo = -1;
                let nextOffset: number | null = null;
                let nextNode: { node: IModelNode<any>; offset: number; depth: number } | null = null;
                for (let n = 0, nn = this.currentNode.node.children.length; n < nn; n++) {
                    const child = this.currentNode.node.children.at(n);
                    if (offset + child.size > this.from) {
                        removeFrom = Math.min(n, removeFrom);
                        if (offset + child.size <= this.to) {
                            removeTo = Math.max(n, removeTo);
                        } else {
                            // Partial removal
                            nextOffset = offset;
                            nextNode = {
                                node: child,
                                offset: offset - this.currentOffset,
                                depth: this.currentNode.offset - 1,
                            };
                            break;
                        }
                    }
                    offset += child.size;
                }
                this.removedFragments.push(new Fragment(this.currentNode.node.children.slice(removeFrom, removeTo), 0));
                this.currentNode.node.replace(removeFrom, removeTo, []);
                if (nextOffset !== null && nextNode) {
                    this.currentOffset = nextOffset;
                    this.currentNode = nextNode;
                    return;
                }
            }
        }

        this.currentOffset = this.currentOffset + this.currentNode.node.size;
        if (this.currentNode.node.nextSibling) {
            this.currentNode = { node: this.currentNode.node.nextSibling, offset: 0, depth: this.currentNode.depth };
        } else {
            this.currentNode = {
                node: this.currentNode.node.parent!,
                offset: getNodeOffsetRelativeToParent(this.currentNode.node) + this.currentNode.node.size,
                depth: this.currentNode.depth + 1,
            };
        }
    }
}

class Inserter {
    protected ran = false;

    constructor(protected root: IModelRoot<any>, protected from: number, protected fragments: IFragment[]) {}

    run() {
        if (this.ran) {
            throw new Error('Inserter can only be run once.');
        }
        // TODO
        this.ran = true;
    }
}

function getNodeOffsetRelativeToParent(node: IModelNode<any>) {
    let offset = 0;
    let previousSibling = node.previousSibling;
    while (previousSibling) {
        offset += previousSibling.size;
        previousSibling = previousSibling.previousSibling;
    }
    return offset;
}
