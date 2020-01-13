import { findCommonLineage } from '../tree/utility';
import { IAtomicLayoutNode } from './atomic-node';
import { IBlockLayoutNode } from './block-node';
import { IDocLayoutNode } from './doc-node';
import { IInlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { ILayoutNode } from './node';
import { NodeBreaker } from './node-breaker';
import { NodeJoiner } from './node-joiner';
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

export class LayoutFlower implements ILayoutFlower {
    protected nodeQueue = new NodeQueue();
    protected nodeJoiner = new NodeJoiner();
    protected nodeBreaker = new NodeBreaker();
    protected updatedNode?: ILayoutNode;
    protected ran: boolean = false;

    flow(node: ILayoutNode) {
        if (this.ran) {
            throw new Error('Layout flower has already been run.');
        }
        this.updatedNode = node;
        this.nodeQueue.queue(node);
        this.flushLineNodeQueue();
        this.flushPageNodeQueue();
        return this.updatedNode;
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
            this.recordNodeAsUpdated(pageNode);
            const newPageNode = this.nodeBreaker.break(pageNode) as IPageLayoutNode | undefined;
            if (!newPageNode) {
                pageNode.markAsFlowed();
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
            this.recordNodeAsUpdated(lineNode);
            const newLineNode = this.nodeBreaker.break(lineNode) as ILineLayoutNode | undefined;
            if (!newLineNode) {
                lineNode.markAsFlowed();
                break;
            }
            lineNode.getParent()!.appendChildAfter(newLineNode, lineNode);
            lineNode.markAsFlowed();
            lineNode = newLineNode;
        }
        let parentNode: ILayoutNode | undefined = node.getParent();
        while (parentNode) {
            if (identifyLayoutNodeType(parentNode) === 'Page') {
                this.nodeQueue.queue(node.getParent()!.getParent()!);
                break;
            }
            parentNode = parentNode.getParent();
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

    protected recordNodeAsUpdated(node: ILayoutNode) {
        this.updatedNode = findCommonLineage(node, this.updatedNode!) as ILayoutNode;
    }

    protected getNodeLineage(node: ILayoutNode) {
        const lineage: ILayoutNode[] = [];
        let currentNode: ILayoutNode = node;
        while (true) {
            lineage.unshift(currentNode);
            if (currentNode.isRoot()) {
                return lineage;
            }
            currentNode = currentNode.getParent()!;
        }
    }
}
