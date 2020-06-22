import { Fragment } from '../fragment';
import { IModelNode } from '../node';
import { IModelRoot } from '../root';
import { Mutator } from './mutator';

type IRemoverState = 'end' | 'forward' | 'enter' | 'fullNode' | 'text' | 'partialNode';

export class Remover extends Mutator<IRemoverState> {
    readonly removedFragments: Fragment[] = [];

    protected current: { offset: number; node: IModelNode<any>; nodeFrom: number; nodeTo: number };

    constructor(protected root: IModelRoot<any>, protected from: number, protected to: number) {
        super();
        const position = root.resolvePosition(from);
        const { node } = position.atReverseDepth(0);
        this.current = {
            offset: from,
            node,
            nodeFrom: -1,
            nodeTo: -1,
        };
        this.updateCurrentNode(node);
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
            case 'forward':
                this.handleForward();
                break;
            case 'enter':
                this.handleEnter();
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
        if (position.depth === 1) {
            const removeFrom = position.atDepth(0).index;
            const nodesToRemove: IModelNode<any>[] = [];
            const removeToOffset = Math.min(this.to - this.current.nodeFrom, this.current.node.size);
            let offset = position.atDepth(0).offset;
            let node: IModelNode<any> | null = this.current.node.children.at(removeFrom);
            while (node && offset + node.size <= removeToOffset) {
                nodesToRemove.push(node);
                offset += node.size;
                node = node.nextSibling;
            }
            const removeTo = removeFrom + nodesToRemove.length;
            this.recordRemovedNodes(nodesToRemove, position.depth);
            this.current.node.replace(removeFrom, removeTo, []);
            if (node) {
                this.joinNodeWithPreviousSibling(node);
            }
        }
        this.stepDown();
    }

    protected handleText() {
        const removeFrom = this.current.offset - this.current.nodeFrom - 1;
        const removeTo = Math.min(this.to - this.current.nodeFrom - 1, this.current.node.size - 2);
        const removedText = this.current.node.replace(removeFrom, removeTo, '') as string;
        this.recordRemovedText(removedText);
    }

    protected handleForward() {
        this.stepForward();
    }

    protected handleEnter() {
        this.current.offset++;
    }

    protected handleEnd() {
        this.inProgress = false;
    }

    protected stepUp() {
        const parentNode = this.current.node.parent!;
        this.updateCurrentNode(parentNode);
    }

    protected stepDown() {
        const nodeOffset = this.current.offset - this.current.nodeFrom;
        const position = this.current.node.resolvePosition(nodeOffset);
        const childNode = this.current.node.children.at(position.atDepth(0).index);
        this.updateCurrentNode(childNode);
    }

    protected stepForward() {
        const nextNode = this.current.node.nextSibling;
        if (nextNode) {
            this.updateCurrentNode(nextNode);
            this.current.offset = this.current.nodeFrom;
        } else {
            const parentNode = this.current.node.parent!;
            this.current.offset = this.current.nodeTo;
            this.updateCurrentNode(parentNode);
        }
    }

    protected get state() {
        if (this.current.offset >= this.to) {
            return 'end';
        }
        if (this.current.nodeTo - this.current.offset === 1) {
            return 'forward';
        }
        if (this.current.offset === this.current.nodeFrom && this.current.nodeTo <= this.to) {
            return 'fullNode';
        }
        if (this.current.offset === this.current.nodeFrom) {
            return 'enter';
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
        this.to -= size;
    }

    protected recordRemovedText(text: string) {
        this.removedFragments.push(new Fragment(text, 0));
        this.current.nodeTo -= text.length;
        this.to -= text.length;
    }

    protected joinNodeWithPreviousSibling(node: IModelNode<any>) {
        let previousSibling = node.previousSibling;
        if (!previousSibling) {
            if (node.parent) {
                this.joinNodeWithPreviousSibling(node.parent);
            }
            return;
        }
        const nodeOffset = this.getOffsetToRoot(node);
        if (this.current.offset >= nodeOffset - 1) {
            if (this.current.offset > nodeOffset) {
                this.current.offset--;
            }
            this.current.offset--;
        }
        this.to -= 2;
        const childNodeToJoin = node.firstChild;
        this.joinNodes(previousSibling, node);
        if (childNodeToJoin) {
            this.joinNodeWithPreviousSibling(childNodeToJoin);
        }
        if (this.current.node === node) {
            this.updateCurrentNode(previousSibling);
        }
    }

    protected updateCurrentNode(node: IModelNode<any>) {
        this.current.node = node;
        this.current.nodeFrom = this.getOffsetToRoot(node);
        this.current.nodeTo = this.current.nodeFrom + node.size;
    }

    protected getOffsetToRoot(node: IModelNode<any>) {
        let offset = 0;
        let n = node;
        while (n.parent) {
            offset += this.getOffsetToParent(n);
            n = n.parent;
        }
        return offset;
    }

    protected getOffsetToParent(node: IModelNode<any>) {
        let offset = 1;
        let previousSibling = node.previousSibling;
        while (previousSibling) {
            offset += previousSibling.size;
            previousSibling = previousSibling.previousSibling;
        }
        return offset;
    }
}
