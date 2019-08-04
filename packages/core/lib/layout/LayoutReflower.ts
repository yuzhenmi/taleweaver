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
    protected rootNode?: AnyLayoutNode;
    protected lineNodeQueue: LineNode[] = [];
    protected lineNodeReflowStatuses: Map<string, boolean> = new Map();
    protected pageNodeQueue: PageNode[] = [];
    protected pageNodeReflowStatuses: Map<string, boolean> = new Map();
    protected ran: boolean = false;

    constructor(editor: Editor, rootNode: AnyLayoutNode) {
        this.editor = editor;
        this.rootNode = rootNode;
    }

    run() {
        if (!this.ran) {
            this.reflow();
        }
        return this.rootNode!;
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
    }

    protected queuePageNode(pageNode: PageNode) {
        this.pageNodeQueue.push(pageNode);
        this.pageNodeReflowStatuses.set(pageNode.getID(), false);
    }

    protected flushQueuedLineNodes() {
        let lineNode: LineNode;
        for (let n = 0; n < this.lineNodeQueue.length; n++) {
            lineNode = this.lineNodeQueue[n];
            this.reflowLineNode(lineNode);
        }
        this.lineNodeQueue = [];
    }

    protected flushQueuedPageNodes() {
        let pageNode: PageNode;
        for (let n = 0; n < this.pageNodeQueue.length; n++) {
            pageNode = this.pageNodeQueue[n];
            this.reflowPageNode(pageNode);
        }
        this.pageNodeQueue = [];
    }

    protected reflowLineNode(lineNode: LineNode) {
        if (this.lineNodeReflowStatuses.get(lineNode.getID())) {
            return;
        }
        const parentNode = lineNode.getParent()!;
        const maxWidth = parentNode.getWidth();
        let currentLineNode = lineNode;
        while (true) {
            const newLineNode = this.breakLineNode(currentLineNode, maxWidth);
            if (!newLineNode) {
                break;
            }
            const nextLineNode = currentLineNode.getNextSibling();
            if (nextLineNode) {
                parentNode.insertBefore(newLineNode, nextLineNode);
            } else {
                parentNode.appendChild(newLineNode);
            }
            currentLineNode = newLineNode;
        }
        this.lineNodeReflowStatuses.set(lineNode.getID(), true);
    }

    protected reflowPageNode(pageNode: PageNode) {
        if (this.pageNodeReflowStatuses.get(pageNode.getID())) {
            return;
        }
        // TODO: Reflow page node
        this.pageNodeReflowStatuses.set(pageNode.getID(), true);
    }

    protected breakLineNode(lineNode: LineNode, width: number) {
        const inlineNodes = lineNode.getChildNodes();
        let cumulatedWidth = 0;
        for (let n = 0; n < inlineNodes.length; n++) {
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
        for (let n = 0; n < atomicNodes.length; n++) {
            const atomicNode = atomicNodes[n];
            if (cumulatedWidth + atomicNode.getWidthWithoutTrailingWhitespace() > width) {
                const newInlineNode = inlineNode.splitAt(n + 1);
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
