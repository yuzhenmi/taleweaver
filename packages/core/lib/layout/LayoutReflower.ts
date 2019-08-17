import Editor from '../Editor';
import AtomicNode from './AtomicLayoutNode';
import BlockNode from './BlockLayoutNode';
import DocNode from './DocLayoutNode';
import InlineNode from './InlineLayoutNode';
import { AnyLayoutNode } from './LayoutNode';
import LineNode from './LineLayoutNode';
import PageNode from './PageLayoutNode';

export default class LayoutReflower {
    protected editor: Editor;
    protected rootNode: AnyLayoutNode;
    protected updatedNode: AnyLayoutNode;
    protected lineNodeQueue: LineNode[] = [];
    protected lineNodeReflowStatuses: Map<string, boolean> = new Map();
    protected pageNodeQueue: PageNode[] = [];
    protected pageNodeReflowStatuses: Map<string, boolean> = new Map();
    protected ran: boolean = false;

    constructor(editor: Editor, rootNode: AnyLayoutNode) {
        this.editor = editor;
        this.rootNode = rootNode;
        this.updatedNode = rootNode;
    }

    run() {
        if (!this.ran) {
            this.reflow();
        }
        return this.updatedNode;
    }

    protected reflow() {
        this.ran = true;
        if (this.rootNode instanceof DocNode) {
            this.queueDocNode(this.rootNode);
        } else if (this.rootNode instanceof BlockNode) {
            this.queueBlockNode(this.rootNode);
        } else if (this.rootNode instanceof InlineNode) {
            this.queueInlineNode(this.rootNode);
        } else if (this.rootNode instanceof AtomicNode) {
            this.queueAtomicNode(this.rootNode);
        } else {
            throw new Error('Error reflowing layout, unknown root node.');
        }
        this.flushQueuedLineNodes();
        this.flushQueuedPageNodes();
    }

    protected queueDocNode(docNode: DocNode) {
        docNode.getChildNodes().forEach(pageNode => {
            pageNode.getChildNodes().forEach(blockNode => {
                this.queueBlockNode(blockNode);
            });
        });
    }

    protected queueBlockNode(blockNode: BlockNode) {
        blockNode.getChildNodes().forEach(lineNode => {
            this.queueLineNode(lineNode);
        });
    }

    protected queueInlineNode(inlineNode: InlineNode) {
        this.queueLineNode(inlineNode.getParent()!);
    }

    protected queueAtomicNode(atomicNode: AtomicNode) {
        this.queueInlineNode(atomicNode.getParent()!);
    }

    protected queueLineNode(lineNode: LineNode) {
        this.lineNodeQueue.push(lineNode);
        this.lineNodeReflowStatuses.set(lineNode.getID(), false);
        this.queuePageNode(lineNode.getParent()!.getParent()!);
    }

    protected queuePageNode(pageNode: PageNode) {
        this.pageNodeQueue.push(pageNode);
        this.pageNodeReflowStatuses.set(pageNode.getID(), false);
    }

    protected flushQueuedLineNodes() {
        let lineNode: LineNode;
        let reflowed = false;
        for (let n = 0; n < this.lineNodeQueue.length; n++) {
            lineNode = this.lineNodeQueue[n];
            if (this.reflowLineNode(lineNode)) {
                reflowed = true;
            }
        }
        if (reflowed) {
            const updatedNode = this.lineNodeQueue[0].getParent();
            let node = this.updatedNode;
            while (node && !node.isRoot()) {
                node = node.getParent();
                if (node === updatedNode) {
                    this.updatedNode = node;
                    break;
                }
            }
        }
        this.lineNodeQueue = [];
    }

    protected flushQueuedPageNodes() {
        let pageNode: PageNode;
        let reflowed = false;
        for (let n = 0; n < this.pageNodeQueue.length; n++) {
            pageNode = this.pageNodeQueue[n];
            if (this.reflowPageNode(pageNode)) {
                reflowed = true;
            }
        }
        if (reflowed) {
            this.updatedNode = this.pageNodeQueue[0].getParent()!;
        }
        this.pageNodeQueue = [];
    }

    protected reflowPageNode(pageNode: PageNode) {
        if (this.pageNodeReflowStatuses.get(pageNode.getID())) {
            return false;
        }
        const parentNode = pageNode.getParent()!;
        const maxHeight = pageNode.getInnerHeight();
        let currentPageNode = pageNode;
        let reflowed = false;
        while (true) {
            const newPageNode = this.breakPageNode(currentPageNode, maxHeight);
            if (!newPageNode) {
                break;
            }
            reflowed = true;
            const nextPageNode = currentPageNode.getNextSibling();
            if (nextPageNode) {
                parentNode.insertBefore(newPageNode, nextPageNode);
            } else {
                parentNode.appendChild(newPageNode);
            }
            this.pageNodeReflowStatuses.set(pageNode.getID(), true);
            currentPageNode = newPageNode;
        }
        return reflowed;
    }

    protected reflowLineNode(lineNode: LineNode) {
        if (this.lineNodeReflowStatuses.get(lineNode.getID())) {
            return false;
        }
        const parentNode = lineNode.getParent()!;
        const maxWidth = parentNode.getWidth();
        let currentLineNode = lineNode;
        let reflowed = false;
        while (true) {
            const newLineNode = this.breakLineNode(currentLineNode, maxWidth);
            if (!newLineNode) {
                break;
            }
            reflowed = true;
            const nextLineNode = currentLineNode.getNextSibling();
            if (nextLineNode) {
                parentNode.insertBefore(newLineNode, nextLineNode);
            } else {
                parentNode.appendChild(newLineNode);
            }
            this.lineNodeReflowStatuses.set(currentLineNode.getID(), true);
            currentLineNode = newLineNode;
        }
        return reflowed;
    }

    protected breakPageNode(pageNode: PageNode, height: number) {
        const blockNodes = pageNode.getChildNodes();
        let cumulatedHeight = 0;
        for (let n = 0, nn = blockNodes.length; n < nn; n++) {
            const blockNode = blockNodes[n];
            if (cumulatedHeight + blockNode.getHeight() > height) {
                const newPageNode = pageNode.splitAt(n + 1);
                const blockNodes = pageNode.getChildNodes();
                const trailingBlockNode = blockNodes[blockNodes.length - 1];
                const newBlockNode = this.breakBlockNode(trailingBlockNode, height - cumulatedHeight);
                if (newBlockNode) {
                    if (newBlockNode === blockNode) {
                        pageNode.removeChild(blockNode);
                    }
                    if (newPageNode.getChildNodes().length > 0) {
                        newPageNode.insertBefore(newBlockNode, newPageNode.getChildNodes()[0]);
                    } else {
                        newPageNode.appendChild(newBlockNode);
                    }
                }
                return newPageNode;
            }
            cumulatedHeight += blockNode.getHeight();
        }
        return null;
    }

    protected breakBlockNode(blockNode: BlockNode, height: number) {
        const lineNodes = blockNode.getChildNodes();
        let cumulatedHeight = 0;
        for (let n = 0, nn = lineNodes.length; n < nn; n++) {
            const lineNode = lineNodes[n];
            if (cumulatedHeight + lineNode.getHeight() > height) {
                if (n === 0) {
                    return blockNode;
                }
                const newBlockNode = blockNode.splitAt(n);
                return newBlockNode;
            }
            cumulatedHeight += blockNode.getHeight();
        }
        return null;
    }

    protected breakLineNode(lineNode: LineNode, width: number) {
        const inlineNodes = lineNode.getChildNodes();
        let cumulatedWidth = 0;
        for (let n = 0, nn = inlineNodes.length; n < nn; n++) {
            const inlineNode = inlineNodes[n];
            if (cumulatedWidth + inlineNode.getWidthWithoutTrailingWhitespace() > width) {
                const newLineNode = lineNode.splitAt(n + 1);
                const inlineNodes = lineNode.getChildNodes();
                const trailingInlineNode = inlineNodes[inlineNodes.length - 1];
                const newInlineNode = this.breakInlineNode(trailingInlineNode, width - cumulatedWidth);
                if (newInlineNode) {
                    if (newLineNode.getChildNodes().length > 0) {
                        newLineNode.insertBefore(newInlineNode, newLineNode.getChildNodes()[0]);
                    } else {
                        newLineNode.appendChild(newInlineNode);
                    }
                }
                return newLineNode;
            }
            cumulatedWidth += inlineNode.getWidth();
        }
        return null;
    }

    protected breakInlineNode(inlineNode: InlineNode, width: number) {
        const atomicNodes = inlineNode.getChildNodes();
        let cumulatedWidth = 0;
        for (let n = 0, nn = atomicNodes.length; n < nn; n++) {
            const atomicNode = atomicNodes[n];
            if (cumulatedWidth + atomicNode.getWidthWithoutTrailingWhitespace() > width) {
                let newInlineNode: InlineNode;
                if (atomicNode.getWidthWithoutTrailingWhitespace() > width) {
                    newInlineNode = inlineNode.splitAt(n + 1);
                    const atomicNodes = inlineNode.getChildNodes();
                    const trailingAtomicNode = atomicNodes[atomicNodes.length - 1];
                    const newAtomicNode = this.breakAtomicNode(trailingAtomicNode, width - cumulatedWidth);
                    if (newAtomicNode) {
                        if (newInlineNode.getChildNodes().length > 0) {
                            newInlineNode.insertBefore(newAtomicNode, newInlineNode.getChildNodes()[0]);
                        } else {
                            newInlineNode.appendChild(newAtomicNode);
                        }
                    }
                } else {
                    newInlineNode = inlineNode.splitAt(n);
                }
                return newInlineNode;
            }
            cumulatedWidth += atomicNode.getWidth();
        }
        return null;
    }

    protected breakAtomicNode(atomicNode: AtomicNode, width: number) {
        if (atomicNode.getWidthWithoutTrailingWhitespace() <= width) {
            return null;
        }
        return atomicNode.splitAtWidth(width);
    }
}
