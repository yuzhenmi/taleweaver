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
    protected reflowedRootNode?: AnyLayoutNode;
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
        return this.reflowedRootNode!;
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
        // TODO: Reflow line node
        this.lineNodeReflowStatuses.set(lineNode.getID(), true);
    }

    protected reflowPageNode(pageNode: PageNode) {
        if (this.pageNodeReflowStatuses.get(pageNode.getID())) {
            return;
        }
        // TODO: Reflow page node
        this.pageNodeReflowStatuses.set(pageNode.getID(), true);
    }
}
