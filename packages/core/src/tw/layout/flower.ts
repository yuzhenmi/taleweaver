import { findCommonLineage } from '../tree/utility';
import { ILayoutAtom } from './atom';
import { ILayoutBlock } from './block';
import { ILayoutDoc } from './doc';
import { ILayoutInline } from './inline';
import { ILayoutLine } from './line';
import { ILayoutNode } from './node';
import { NodeBreaker } from './node-breaker';
import { NodeJoiner } from './node-joiner';
import { ILayoutPage } from './page';
import { identifyLayoutNodeType } from './utility';

export interface ILayoutFlower {
    flow(node: ILayoutNode): void;
}

class NodeQueue {
    protected lineNodes: ILayoutLine[] = [];
    protected pageNodes: ILayoutPage[] = [];

    queue(node: ILayoutNode) {
        switch (identifyLayoutNodeType(node)) {
            case 'Doc':
                this.queueDocNode(node as ILayoutDoc);
                break;
            case 'Page':
                this.queuePageNode(node as ILayoutPage);
                break;
            case 'Block':
                this.queueBlockNode(node as ILayoutBlock);
                break;
            case 'Line':
                this.queueLineNode(node as ILayoutLine);
                break;
            case 'Inline':
                this.queueInlineNode(node as ILayoutInline);
                break;
            case 'Atomic':
                this.queueAtomicNode(node as ILayoutAtom);
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

    protected queueDocNode(node: ILayoutDoc) {
        node.getChildren().forEach((child) => this.queue(child));
    }

    protected queuePageNode(node: ILayoutPage) {
        this.pageNodes.push(node);
        node.getChildren().forEach((child) => this.queue(child));
    }

    protected queueBlockNode(node: ILayoutBlock) {
        node.getChildren().forEach((child) => this.queue(child));
    }

    protected queueLineNode(node: ILayoutLine) {
        this.lineNodes.push(node);
    }

    protected queueInlineNode(node: ILayoutInline) {
        this.queue(node.getParent()!);
    }

    protected queueAtomicNode(node: ILayoutAtom) {
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
        let node: ILayoutLine | undefined;
        while ((node = this.nodeQueue.popLineNode())) {
            this.flowLineNode(node);
        }
    }

    protected flushPageNodeQueue() {
        let node: ILayoutPage | undefined;
        while ((node = this.nodeQueue.popPageNode())) {
            this.flowPageNode(node);
        }
    }

    protected flowPageNode(node: ILayoutPage) {
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
        let pageNode: ILayoutPage | undefined = node;
        while (pageNode) {
            this.recordNodeAsUpdated(pageNode);
            const newPageNode = this.nodeBreaker.break(pageNode) as ILayoutPage | undefined;
            if (!newPageNode) {
                pageNode.markAsFlowed();
                break;
            }
            pageNode.getParent()!.appendChildAfter(newPageNode, pageNode);
            pageNode.markAsFlowed();
            pageNode = newPageNode;
        }
    }

    protected flowLineNode(node: ILayoutLine) {
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
        let lineNode: ILayoutLine | undefined = node;
        while (lineNode) {
            this.recordNodeAsUpdated(lineNode);
            const newLineNode = this.nodeBreaker.break(lineNode) as ILayoutLine | undefined;
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

    protected joinNextPageNode(node: ILayoutPage) {
        const nextNode = node.getNextSibling() as ILayoutPage;
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

    protected joinNextLineNode(node: ILayoutLine) {
        const nextNode = node.getNextSibling() as ILayoutLine;
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
