import { ILayoutNode } from 'tw/layout/node';
import { IAtomicLayoutNode } from './atomic-node';
import { IBlockLayoutNode } from './block-node';
import { IDocLayoutNode } from './doc-node';
import { IInlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { IPageLayoutNode } from './page-node';
import { identifyLayoutNodeType } from './utility';

export interface ILayoutFlower {
    flow(node: ILayoutNode): void;
}

class NodeQueue {
    protected lineNodes: ILineLayoutNode[] = [];
    protected pageNodes: IPageLayoutNode[] = [];

    queue(node: ILayoutNode) {
        switch (identifyLayoutNodeType(node)) {
            case 'Doc':
                this.queueDocNode(node as IDocLayoutNode);
                break;
            case 'Page':
                this.queuePageNode(node as IPageLayoutNode);
                break;
            case 'Block':
                this.queueBlockNode(node as IBlockLayoutNode);
                break;
            case 'Line':
                this.queueLineNode(node as ILineLayoutNode);
                break;
            case 'Inline':
                this.queueInlineNode(node as IInlineLayoutNode);
                break;
            case 'Atomic':
                this.queueAtomicNode(node as IAtomicLayoutNode);
                break;
            default:
                throw new Error('Invalid layout node type.');
        }
    }

    popLineNode() {
        return this.lineNodes.shift();
    }

    popPageNode() {
        return this.pageNodes.shift();
    }

    protected queueDocNode(node: IDocLayoutNode) {
        node.getChildren().forEach(child => this.queue(child));
    }

    protected queuePageNode(node: IPageLayoutNode) {
        this.pageNodes.push(node);
        node.getChildren().forEach(child => this.queue(child));
    }

    protected queueBlockNode(node: IBlockLayoutNode) {
        node.getChildren().forEach(child => this.queue(child));
    }

    protected queueLineNode(node: ILineLayoutNode) {
        this.lineNodes.push(node);
    }

    protected queueInlineNode(node: IInlineLayoutNode) {
        this.queue(node.getParent()!);
    }

    protected queueAtomicNode(node: IAtomicLayoutNode) {
        this.queue(node.getParent()!);
    }
}

class NodeJoiner {
    join(thisNode: ILayoutNode, thatNode: ILayoutNode) {
        if (identifyLayoutNodeType(thisNode) !== identifyLayoutNodeType(thatNode)) {
            throw new Error('Nodes to be joined must be of the same type.');
        }
        switch (identifyLayoutNodeType(thisNode)) {
            case 'Page':
                this.joinPageNodes(thisNode as IPageLayoutNode, thatNode as IPageLayoutNode);
                break;
            case 'Line':
                this.joinLineNodes(thisNode as ILineLayoutNode, thatNode as ILineLayoutNode);
                break;
            default:
                throw new Error('Invalid layout node type.');
        }
    }

    protected joinPageNodes(thisNode: IPageLayoutNode, thatNode: IPageLayoutNode) {
        const thisLastChild = thisNode.getLastChild();
        const thatFirstChild = thatNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getId() === thatFirstChild.getId()) {
            this.joinBlockNodes(thisLastChild, thatFirstChild);
        }
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinBlockNodes(thisNode: IBlockLayoutNode, thatNode: IBlockLayoutNode) {
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinLineNodes(thisNode: ILineLayoutNode, thatNode: ILineLayoutNode) {
        const thisLastChild = thisNode.getLastChild();
        const thatFirstChild = thatNode.getFirstChild();
        if (thisLastChild && thatFirstChild && thisLastChild.getId() === thatFirstChild.getId()) {
            this.joinInlineNodes(thisLastChild, thatFirstChild);
        }
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }

    protected joinInlineNodes(thisNode: IInlineLayoutNode, thatNode: IInlineLayoutNode) {
        thatNode
            .getChildren()
            .slice()
            .forEach(child => {
                thatNode.removeChild(child);
                thisNode.appendChild(child);
            });
        const thatParent = thatNode.getParent();
        if (thatParent) {
            thatParent.removeChild(thatNode);
        }
    }
}

class NodeBreaker {
    break(node: ILayoutNode) {
        switch (identifyLayoutNodeType(node)) {
            case 'Page':
                return this.breakPageNode(node as IPageLayoutNode);
            case 'Line':
                return this.breakLineNode(node as ILineLayoutNode);
            default:
                throw new Error('Invalid layout node type.');
        }
    }

    protected breakPageNode(node: IPageLayoutNode) {
        const height = node.getInnerHeight();
        let cumulatedHeight = 0;
        const blockNodes = node.getChildren();
        for (let n = 0; n < blockNodes.length; n++) {
            const blockNode = blockNodes[n];
            if (cumulatedHeight + (blockNode.getHeight() - blockNode.getPaddingBottom()) > height) {
                const newPageNode = node.clone();
                for (let blockNodeToMove of node.getChildren().slice(n + 1)) {
                    node.removeChild(blockNodeToMove);
                    newPageNode.appendChild(blockNodeToMove);
                }
                const lastBlockNode = node.getLastChild();
                if (lastBlockNode) {
                    const newBlockNode = this.breakBlockNode(lastBlockNode, height - cumulatedHeight);
                    if (newBlockNode) {
                        newPageNode.insertChild(newBlockNode);
                    }
                    if (lastBlockNode.getChildren().length === 0) {
                        node.removeChild(lastBlockNode);
                    }
                }
                return newPageNode;
            }
            cumulatedHeight += blockNode.getHeight();
        }
        return undefined;
    }

    protected breakBlockNode(node: IBlockLayoutNode, height: number) {
        let cumulatedHeight = 0;
        const lineNodes = node.getChildren();
        for (let n = 0; n < lineNodes.length; n++) {
            const lineNode = lineNodes[n];
            if (cumulatedHeight + lineNode.getHeight() > height) {
                const newBlockNode = node.clone();
                for (let lineNodeToMove of node.getChildren().slice(n)) {
                    node.removeChild(lineNodeToMove);
                    newBlockNode.appendChild(lineNodeToMove);
                }
                return newBlockNode;
            }
            cumulatedHeight += lineNode.getHeight();
        }
        return undefined;
    }

    protected breakLineNode(node: ILineLayoutNode) {
        const width = node.getInnerWidth();
        let cumulatedWidth = 0;
        const inlineNodes = node.getChildren();
        for (let n = 0; n < inlineNodes.length; n++) {
            const inlineNode = inlineNodes[n];
            if (cumulatedWidth + inlineNode.getTailTrimmedWidth() > width) {
                const newLineNode = node.clone();
                for (let inlineNodeToMove of node.getChildren().slice(n + 1)) {
                    node.removeChild(inlineNodeToMove);
                    newLineNode.appendChild(inlineNodeToMove);
                }
                const lastInlineNode = node.getLastChild();
                if (lastInlineNode) {
                    const newInlineNode = this.breakInlineNode(lastInlineNode, width - cumulatedWidth);
                    if (newInlineNode) {
                        newLineNode.insertChild(newInlineNode);
                    }
                    if (lastInlineNode.getChildren().length === 0) {
                        node.removeChild(lastInlineNode);
                    }
                }
                return newLineNode;
            }
            cumulatedWidth += inlineNode.getWidth();
        }
        return undefined;
    }

    protected breakInlineNode(node: IInlineLayoutNode, width: number) {
        let cumulatedWidth = 0;
        const atomicNodes = node.getChildren();
        for (let n = 0; n < atomicNodes.length; n++) {
            const atomicNode = atomicNodes[n];
            if (cumulatedWidth + atomicNode.getTailTrimmedWidth() > width) {
                const newInlineNode = node.clone();
                for (let atomicNodeToMove of node.getChildren().slice(n)) {
                    node.removeChild(atomicNodeToMove);
                    newInlineNode.appendChild(atomicNodeToMove);
                }
                return newInlineNode;
            }
            cumulatedWidth += atomicNode.getWidth();
        }
        return undefined;
    }
}

export class LayoutFlower implements ILayoutFlower {
    protected nodeQueue = new NodeQueue();
    protected nodeJoiner = new NodeJoiner();
    protected nodeBreaker = new NodeBreaker();
    protected ran: boolean = false;

    flow(node: ILayoutNode) {
        if (this.ran) {
            throw new Error('Layout flower has already been run.');
        }
        this.nodeQueue.queue(node);
        this.flushLineNodeQueue();
        this.flushPageNodeQueue();
    }

    protected flushLineNodeQueue() {
        let node: ILineLayoutNode | undefined;
        while ((node = this.nodeQueue.popLineNode())) {
            this.flowLineNode(node);
        }
    }

    protected flushPageNodeQueue() {
        let node: IPageLayoutNode | undefined;
        while ((node = this.nodeQueue.popPageNode())) {
            this.flowPageNode(node);
        }
    }

    protected flowPageNode(node: IPageLayoutNode) {
        if (node.isFlowed()) {
            return;
        }
        if (!node.getParent()) {
            return;
        }
        if (this.joinNextPageNode(node)) {
            this.nodeQueue.queue(node);
            return;
        }
        let pageNode: IPageLayoutNode | undefined = node;
        while (pageNode) {
            const newPageNode = this.nodeBreaker.break(pageNode) as IPageLayoutNode | undefined;
            if (!newPageNode) {
                break;
            }
            pageNode.getParent()!.appendChildAfter(newPageNode, pageNode);
            pageNode.markAsFlowed();
            pageNode = newPageNode;
        }
    }

    protected flowLineNode(node: ILineLayoutNode) {
        if (node.isFlowed()) {
            return;
        }
        if (!node.getParent()) {
            return;
        }
        if (this.joinNextLineNode(node)) {
            this.nodeQueue.queue(node);
            return;
        }
        let lineNode: ILineLayoutNode | undefined = node;
        while (lineNode) {
            const newLineNode = this.nodeBreaker.break(lineNode) as ILineLayoutNode | undefined;
            if (!newLineNode) {
                break;
            }
            lineNode.getParent()!.appendChildAfter(newLineNode, lineNode);
            lineNode.markAsFlowed();
            lineNode = newLineNode;
        }
    }

    protected joinNextPageNode(node: IPageLayoutNode) {
        const nextNode = node.getNextSibling() as IPageLayoutNode;
        if (!nextNode) {
            return false;
        }
        const nextBlockChild = node.getFirstChild();
        if (!nextBlockChild) {
            return false;
        }
        const nextLineNode = nextBlockChild.getFirstChild();
        if (!nextLineNode) {
            return false;
        }
        if (node.getContentHeight() + nextLineNode.getHeight() > node.getHeight()) {
            return false;
        }
        this.nodeJoiner.join(node, nextNode);
        return true;
    }

    protected joinNextLineNode(node: ILineLayoutNode) {
        const nextNode = node.getNextSibling() as ILineLayoutNode;
        if (!nextNode) {
            return false;
        }
        const nextInlineChild = nextNode.getFirstChild();
        if (!nextInlineChild) {
            return false;
        }
        const nextAtomicChild = nextInlineChild.getFirstChild();
        if (!nextAtomicChild) {
            return false;
        }
        if (node.getContentWidth() + nextAtomicChild.getWidth() > node.getWidth()) {
            return false;
        }
        this.nodeJoiner.join(node, nextNode);
        return true;
    }
}
