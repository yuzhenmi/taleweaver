import { Fragment, IFragment } from './fragment';
import { IModelNode } from './node';
import { IModelRoot } from './root';

export interface IChange {
    apply(root: IModelRoot<any>): IChangeResult;
}

export interface IChangeResult {
    readonly change: IChange;
}

export class Replace implements IChange {
    constructor(readonly from: number, readonly to: number, readonly fragments: IFragment[]) {
        this.validateInput();
    }

    apply(root: IModelRoot<any>): IChangeResult {
        this.validateFit(root);
        const fromPosition = root.resolvePosition(this.from);
        const fromPositionLastDepth = fromPosition.atDepth(fromPosition.depth - 1);
        const removedFragments = this.remove(
            this.from,
            this.to,
            fromPositionLastDepth.node,
            this.from - fromPositionLastDepth.offset,
        );
        // TODO: Insert new content
        return { change: this };
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

    protected remove(from: number, to: number, node: IModelNode<any>, nodeFrom: number) {
        const removedFragments: IFragment[] = [];
        const nodeTo = nodeFrom + node.size;
        if (nodeFrom > to) {
            // Past range, break
            return removedFragments;
        }
        // Assume nodeFrom <= from <= nodeTo, nodeFrom <= from <= to
        if (from === nodeFrom && to >= nodeTo) {
            // Node should be fully removed, delegate to parent
            removedFragments.push(
                ...this.remove(from, to, node.parent!, nodeFrom - this.getNodeOffsetRelativeToParent(node)),
            );
        } else {
            if (from < nodeTo) {
                // Part of this node should be removed
                const removeFrom = from - nodeFrom;
                const removeTo = Math.min(to - nodeFrom, node.size);
                if (node.leaf) {
                    removedFragments.push(new Fragment(node.text.slice(removeFrom, removeTo), 0));
                    node.replace(removeFrom, removeTo, '');
                } else {
                    // Remove full nodes, delegate partial removal
                    let offset = nodeFrom;
                    let removeFrom = node.children.length;
                    let removeTo = -1;
                    for (let n = 0, nn = node.children.length; n < nn; n++) {
                        const child = node.children.at(n);
                        if (offset + child.size > from) {
                            if (offset + child.size <= to) {
                                removeFrom = Math.min(n, removeFrom);
                                removeTo = Math.max(n, removeTo);
                            } else {
                                removedFragments.push(...this.remove(offset, to, child, offset));
                                break;
                            }
                        }
                        offset += child.size;
                    }
                    node.replace(removeFrom, removeTo, []);
                }
            }
            // Move on to next sibling if available, else parent
            if (node.nextSibling) {
                removedFragments.push(...this.remove(nodeFrom + node.size, to, node.nextSibling, nodeFrom + node.size));
            } else {
                removedFragments.push(
                    ...this.remove(
                        nodeFrom + node.size,
                        to,
                        node.parent!,
                        nodeFrom - this.getNodeOffsetRelativeToParent(node),
                    ),
                );
            }
        }
        return removedFragments;
    }

    protected getNodeOffsetRelativeToParent(node: IModelNode<any>) {
        let offset = 0;
        let previousSibling = node.previousSibling;
        while (previousSibling) {
            offset += previousSibling.size;
            previousSibling = previousSibling.previousSibling;
        }
        return offset;
    }
}
