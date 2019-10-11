import Editor from '../Editor';
import AtomicNode from './AtomicLayoutNode';
import BlockNode from './BlockLayoutNode';
import DocNode from './DocLayoutNode';
import InlineNode from './InlineLayoutNode';
import { AnyLayoutNode } from './LayoutNode';
import LineNode from './LineLayoutNode';
import PageNode from './PageLayoutNode';

function testIsNextLineJoinable(lineNode: LineNode, maxWidth: number) {
    const nextLineNode = lineNode.getNextSibling();
    if (!nextLineNode) {
        return false;
    }
    let nextAtomicNode: AtomicNode | null = null;
    const nextInlineNodes = nextLineNode.getChildNodes();
    for (let n = 0, nn = nextInlineNodes.length; n < nn; n++) {
        const nextInlineNode = nextInlineNodes[n];
        const nextAtomicNodes = nextInlineNode.getChildNodes();
        for (let m = 0, mm = nextAtomicNodes.length; m < mm; m++) {
            nextAtomicNode = nextAtomicNodes[m];
            break;
        }
        if (nextAtomicNode) {
            break;
        }
    }
    if (!nextAtomicNode) {
        return false;
    }
    const contentWidth = lineNode
        .getChildNodes()
        .reduce((width, childNode) => width + childNode.getWidth(), 0);
    const nextAtomicNodeWidth = nextAtomicNode.getWidthWithoutTrailingWhitespace();
    return contentWidth + nextAtomicNodeWidth <= maxWidth;
}

function testIsNextPageJoinable(pageNode: PageNode, maxHeight: number) {
    const nextPageNode = pageNode.getNextSibling();
    if (!nextPageNode) {
        return false;
    }
    let nextLineNode: LineNode | null = null;
    const nextBlockNodes = nextPageNode.getChildNodes();
    for (let n = 0, nn = nextBlockNodes.length; n < nn; n++) {
        const nextBlockNode = nextBlockNodes[n];
        const nextLineNodes = nextBlockNode.getChildNodes();
        for (let m = 0, mm = nextLineNodes.length; m < mm; m++) {
            nextLineNode = nextLineNodes[m];
            break;
        }
        if (nextLineNode) {
            break;
        }
    }
    if (!nextLineNode) {
        return false;
    }
    const contentHeight = pageNode
        .getChildNodes()
        .reduce((height, childNode) => height + childNode.getHeight(), 0);
    const nextLineNodeHeight = nextLineNode.getHeight();
    return contentHeight + nextLineNodeHeight <= maxHeight;
}

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
        if (this.rootNode instanceof AtomicNode) {
            this.queueAtomicNode(this.rootNode);
        } else if (this.rootNode instanceof InlineNode) {
            this.queueInlineNode(this.rootNode);
        } else if (this.rootNode instanceof BlockNode) {
            this.queueBlockNode(this.rootNode);
        } else if (this.rootNode instanceof DocNode) {
            this.queueDocNode(this.rootNode);
        } else {
            throw new Error('Error reflowing layout, unknown root node.');
        }
        this.flushQueuedLineNodes();
        this.flushQueuedPageNodes();
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

    protected queueBlockNode(blockNode: BlockNode) {
        blockNode.getChildNodes().forEach(lineNode => {
            this.queueLineNode(lineNode);
        });
    }

    protected queuePageNode(pageNode: PageNode) {
        this.pageNodeQueue.push(pageNode);
        this.pageNodeReflowStatuses.set(pageNode.getID(), false);
    }

    protected queueDocNode(docNode: DocNode) {
        docNode.getChildNodes().forEach(pageNode => {
            pageNode.getChildNodes().forEach(blockNode => {
                this.queueBlockNode(blockNode);
            });
        });
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

    protected reflowLineNode(lineNode: LineNode) {
        if (this.lineNodeReflowStatuses.get(lineNode.getID())) {
            return false;
        }
        const parentNode = lineNode.getParent()!;
        const maxWidth = parentNode.getWidth();
        let currentLineNode = lineNode;
        let reflowed = false;
        while (true) {
            if (testIsNextLineJoinable(currentLineNode, maxWidth)) {
                const nextLineNode = currentLineNode.getNextSibling()!;
                currentLineNode.join(nextLineNode);
                nextLineNode.getParent()!.removeChild(nextLineNode);
                this.lineNodeReflowStatuses.set(nextLineNode.getID(), true);
            }
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

    protected reflowPageNode(pageNode: PageNode) {
        if (this.pageNodeReflowStatuses.get(pageNode.getID())) {
            return false;
        }
        const parentNode = pageNode.getParent()!;
        const maxHeight = pageNode.getInnerHeight();
        let currentPageNode = pageNode;
        let reflowed = false;
        while (true) {
            if (testIsNextPageJoinable(currentPageNode, maxHeight)) {
                const nextPageNode = currentPageNode.getNextSibling()!;
                currentPageNode.join(nextPageNode);
                nextPageNode.getParent()!.removeChild(nextPageNode);
                this.pageNodeReflowStatuses.set(nextPageNode.getID(), true);
            }
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

    protected breakAtomicNode(atomicNode: AtomicNode, width: number) {
        if (atomicNode.getWidthWithoutTrailingWhitespace() <= width) {
            return null;
        }
        const newAtomicNode = atomicNode.splitAtWidth(width);
        return newAtomicNode;
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
            cumulatedHeight += lineNode.getHeight();
        }
        return null;
    }

    protected breakPageNode(pageNode: PageNode, height: number) {
        const blockNodes = pageNode.getChildNodes();
        let cumulatedHeight = 0;
        for (let n = 0, nn = blockNodes.length; n < nn; n++) {
            const blockNode = blockNodes[n];
            // excluding padding-bottom，like ms word
            if (cumulatedHeight + (blockNode.getHeight() - blockNode.getPaddingBottom()) > height) {
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
}
