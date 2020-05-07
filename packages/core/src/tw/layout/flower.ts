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
        node.children.forEach((child) => this.queue(child));
    }

    protected queuePageNode(node: ILayoutPage) {
        this.pageNodes.push(node);
        node.children.forEach((child) => this.queue(child));
    }

    protected queueBlockNode(node: ILayoutBlock) {
        node.children.forEach((child) => this.queue(child));
    }

    protected queueLineNode(node: ILayoutLine) {
        this.lineNodes.push(node);
    }

    protected queueInlineNode(node: ILayoutInline) {
        this.queue(node.parent!);
    }

    protected queueAtomicNode(node: ILayoutAtom) {
        this.queue(node.parent!);
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
        if (node.flowed) {
            return;
        }
        if (!node.parent) {
            return;
        }
        if (this.joinNextPageNode(node)) {
            this.nodeQueue.queue(node);
            return;
        }
        let pageNode: ILayoutPage | null = node;
        while (pageNode) {
            this.recordNodeAsUpdated(pageNode);
            const newPageNode = this.nodeBreaker.break(pageNode) as ILayoutPage | null;
            if (!newPageNode) {
                pageNode.markAsFlowed();
                break;
            }
            pageNode.parent!.appendChildAfter(newPageNode, pageNode);
            pageNode.markAsFlowed();
            pageNode = newPageNode;
        }
    }

    protected flowLineNode(node: ILayoutLine) {
        if (node.flowed) {
            return;
        }
        if (!node.parent) {
            return;
        }
        if (this.joinNextLineNode(node)) {
            this.nodeQueue.queue(node);
            return;
        }
        let lineNode: ILayoutLine | null = node;
        while (lineNode) {
            this.recordNodeAsUpdated(lineNode);
            const newLineNode = this.nodeBreaker.break(lineNode) as ILayoutLine | null;
            if (!newLineNode) {
                lineNode.markAsFlowed();
                break;
            }
            lineNode.parent!.appendChildAfter(newLineNode, lineNode);
            lineNode.markAsFlowed();
            lineNode = newLineNode;
        }
        let parentNode: ILayoutNode | null = node.parent;
        while (parentNode) {
            if (identifyLayoutNodeType(parentNode) === 'Page') {
                this.nodeQueue.queue(node.parent!.parent!);
                break;
            }
            parentNode = parentNode.parent;
        }
    }

    protected joinNextPageNode(node: ILayoutPage) {
        const nextNode = node.nextSibling as ILayoutPage;
        if (!nextNode) {
            return false;
        }
        const nextBlockChild = node.firstChild;
        if (!nextBlockChild) {
            return false;
        }
        const nextLineNode = nextBlockChild.firstChild;
        if (!nextLineNode) {
            return false;
        }
        if (node.contentHeight + nextLineNode.height > node.height) {
            return false;
        }
        this.nodeJoiner.join(node, nextNode);
        return true;
    }

    protected joinNextLineNode(node: ILayoutLine) {
        const nextNode = node.nextSibling as ILayoutLine;
        if (!nextNode) {
            return false;
        }
        const nextInlineChild = nextNode.firstChild;
        if (!nextInlineChild) {
            return false;
        }
        const nextAtomicChild = nextInlineChild.firstChild;
        if (!nextAtomicChild) {
            return false;
        }
        if (node.contentWidth + nextAtomicChild.width > node.width) {
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
            if (currentNode.root) {
                return lineage;
            }
            currentNode = currentNode.parent!;
        }
    }
}
