import { Fragment } from '../fragment';
import { IModelNode } from '../node';
import { IModelRoot } from '../root';
import { Mutator } from './mutator';

type IRemoverState = 'end' | 'fullNode' | 'text' | 'partialNode';

export class Remover extends Mutator<IRemoverState> {
    readonly removedFragments: Fragment[] = [];

    protected current: { offset: number; node: IModelNode<any>; nodeFrom: number; nodeTo: number };

    constructor(protected root: IModelRoot<any>, protected from: number, protected to: number) {
        super();
        const position = root.resolvePosition(from);
        const { node, offset: nodeOffset } = position.atDepth(position.depth - 1);
        const nodeFrom = position.atDepth(0).offset - nodeOffset;
        const nodeTo = nodeFrom + node.size;
        this.current = {
            offset: from,
            node,
            nodeFrom,
            nodeTo,
        };
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
        const position = this.current.node.resolvePosition(this.current.offset - this.current.nodeFrom);
        if (position.atDepth(1).offset === 0) {
            const depth = position.depth - 1;
            const nodesToRemove: IModelNode<any>[] = [];
            const removeTo = Math.min(this.to - this.current.nodeFrom, this.current.node.size);
            let offset = position.atDepth(0).offset;
            let node: IModelNode<any> | null = position.atDepth(1).node;
            while (offset < removeTo && node) {
                nodesToRemove.push(node);
                offset += node.size;
                node = node.nextSibling;
            }
            this.recordRemovedNodes(nodesToRemove, depth);
            this.current.node.replace(0, nodesToRemove.length, []);
            if (node) {
                this.joinNodeWithPreviousSibling(node);
            }
        }
        this.stepDown();
    }

    protected handleText() {
        const removeFrom = this.from - this.current.nodeFrom - 1;
        const removeTo = Math.min(this.to - this.current.nodeFrom, this.current.node.size) - 1;
        const removedText = this.current.node.replace(removeFrom, removeTo, '') as string;
        this.recordRemovedText(removedText);
        this.stepForward();
    }

    protected handleEnd() {
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

    protected get state() {
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

    protected recordRemovedNodes(nodes: IModelNode<any>[], depth: number) {
        this.removedFragments.push(new Fragment(nodes, depth));
        const size = nodes.reduce((size, node) => size + node.size, 0);
        this.current.nodeTo -= size;
    }

    protected recordRemovedText(text: string) {
        this.removedFragments.push(new Fragment(text, 0));
        this.current.nodeTo -= text.length;
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
}
