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

export class ReplaceChange implements IChange {
    constructor(readonly from: number, readonly to: number, readonly fragments: IFragment[]) {
        this.validateInput();
    }

    apply(root: IModelRoot<any>): IChangeResult {
        this.validateFit(root);
        const removedFragments = new Remover(root, this.from, this.to).run();
        new Inserter(root, this.from, this.fragments).run();
        return {
            change: this,
            reverseChange: new ReplaceChange(
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

type RemoverState = 'end' | 'fullNode' | 'text' | 'partialNode';

class Remover {
    readonly removedFragments: IFragment[] = [];

    protected ran = false;
    protected inProgress = false;
    protected current: { offset: number; node: IModelNode<any>; nodeFrom: number; nodeTo: number };

    constructor(protected root: IModelRoot<any>, protected from: number, protected to: number) {
        const position = root.resolvePosition(from);
        const { node } = position.atDepth(position.depth - 1);
        let nodeFrom = 0;
        for (let n = 0; n < position.depth; n++) {
            nodeFrom += position.atDepth(n).offset;
        }
        const nodeTo = nodeFrom + node.size;
        this.current = {
            offset: from,
            node,
            nodeFrom,
            nodeTo,
        };
    }

    run() {
        if (this.ran) {
            throw new Error('Remover can only be run once.');
        }
        this.inProgress = true;
        while (this.inProgress) {
            this.next();
        }
        this.ran = true;
        return this.removedFragments;
    }

    protected next() {
        switch (this.state) {
            case 'fullNode':
                this.handleFullNode();
                break;
            case 'partialNode':
                this.handlePartialNode();
                break;
            case 'text':
                this.handleText();
                break;
            case 'end':
                this.handleEnd();
                break;
        }
    }

    protected handleFullNode() {
        this.stepUp();
    }

    protected handlePartialNode() {
        if (this.current.offset === this.current.nodeFrom) {
            const depth = this.current.node.resolvePosition(0).depth - 1;
            const nodesToRemove: IModelNode<any>[] = [];
            const removeTo = Math.min(this.to - this.current.nodeFrom, this.current.node.size);
            let offset = 0;
            let node = this.current.node.firstChild;
            while (offset < removeTo && node) {
                nodesToRemove.push(node);
                offset += node.size;
                node = node.nextSibling;
            }
            this.recordRemovedNodes(nodesToRemove, depth);
            this.current.node.replace(0, nodesToRemove.length, []);
        }
        this.stepDown();
    }

    protected handleText() {
        const removeFrom = this.from - this.current.nodeFrom;
        const removeTo = Math.min(this.to - this.current.nodeFrom, this.current.node.size);
        this.recordRemovedText(this.current.node.text.substring(removeFrom, removeTo));
        this.current.node.replace(removeFrom, removeTo, '');
    }

    protected handleEnd() {
        // TODO: Try to join two ends
        this.inProgress = false;
    }

    protected stepUp() {
        const parentNode = this.current.node.parent!;
        const parentNodeFrom = this.current.nodeFrom - this.getOffsetToParent(this.current.node);
        const parentNodeTo = parentNodeFrom + parentNode.size;
        this.current = {
            offset: this.current.offset,
            node: parentNode,
            nodeFrom: parentNodeFrom,
            nodeTo: parentNodeTo,
        };
    }

    protected stepDown() {
        const nodeOffset = this.current.offset - this.current.nodeFrom;
        const position = this.current.node.resolvePosition(nodeOffset);
        const childNode = position.atDepth(1).node;
        const childNodeFrom = this.current.offset - position.atDepth(1).offset;
        const childNodeTo = childNodeFrom + childNode.size;
        this.current = {
            offset: this.current.offset,
            node: childNode,
            nodeFrom: childNodeFrom,
            nodeTo: childNodeTo,
        };
    }

    protected stepForward() {
        const nextNode = this.current.node.nextSibling;
        if (nextNode) {
            this.current = {
                offset: this.current.nodeTo,
                node: nextNode,
                nodeFrom: this.current.nodeTo,
                nodeTo: this.current.nodeTo + nextNode.size,
            };
        } else {
            const parentNode = this.current.node.parent!;
            const parentNodeFrom = this.current.nodeFrom - this.getOffsetToParent(this.current.node);
            this.current = {
                offset: this.current.nodeTo,
                node: parentNode,
                nodeFrom: parentNodeFrom,
                nodeTo: parentNodeFrom + parentNode.size,
            };
        }
    }

    protected get state(): RemoverState {
        // Assumptions:
        // - from <= to
        // - nodeFrom < nodeTo
        // - offset >= nodeFrom
        // - offset >= from
        if (this.current.offset >= this.to) {
            return 'end';
        }
        if (this.current.offset === this.current.nodeFrom && this.current.nodeTo <= this.to) {
            return 'fullNode';
        }
        if (this.current.node.leaf) {
            return 'text';
        }
        return 'partialNode';
    }

    protected getOffsetToParent(node: IModelNode<any>) {
        let offset = 0;
        let previousSibling = node.previousSibling;
        while (previousSibling) {
            offset += previousSibling.size;
            previousSibling = previousSibling.previousSibling;
        }
        return offset;
    }

    protected recordRemovedNodes(nodes: IModelNode<any>[], depth: number) {
        this.removedFragments.push(new Fragment(nodes, depth));
        const size = nodes.reduce((size, node) => size + node.size, 0);
        this.current.nodeTo -= size;
    }

    protected recordRemovedText(text: string) {
        this.removedFragments.push(new Fragment(text, 0));
        this.current.nodeTo -= text.length;
    }
}

class Inserter {
    protected ran = false;
    protected inProgress = false;
    protected currentOffset: number;
    protected fragmentsToInsert: IFragment[] = [];
    protected currentIndex = 0;

    constructor(protected root: IModelRoot<any>, protected from: number, protected fragments: IFragment[]) {
        this.currentOffset = from;
    }

    run() {
        if (this.ran) {
            throw new Error('Inserter can only be run once.');
        }
        this.inProgress = true;
        while (this.inProgress) {
            this.step();
        }
        this.inProgress = false;
        this.ran = true;
    }

    protected step() {
        if (this.currentIndex >= this.fragments.length) {
            this.inProgress = false;
            return;
        }

        const fragment = this.fragments[this.currentIndex];
        if (this.fragmentsToInsert.length > 0 && this.fragmentsToInsert[0].depth !== fragment.depth) {
            // TODO: Insert
            // TODO: Handle splitting a node, if depth > 0 inserted?
            // TODO: Try to join 2 ends after insertion of depth > 0?
            this.fragmentsToInsert = [];
        }
        this.fragmentsToInsert.push(fragment);
        this.currentIndex++;
    }
}
