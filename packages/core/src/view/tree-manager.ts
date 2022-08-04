import { DOMService } from '../dom/service';
import { IBlockLayoutNode } from '../layout/block-node';
import { IDocLayoutNode } from '../layout/doc-node';
import { IInlineLayoutNode } from '../layout/inline-node';
import { ILineLayoutNode } from '../layout/line-node';
import { ILayoutNode } from '../layout/node';
import { IPageLayoutNode } from '../layout/page-node';
import { ITextLayoutNode } from '../layout/text-node';
import { testDeepEquality } from '../util/compare';
import {
    BlockViewNode,
    DocViewNode,
    IBlockViewNode,
    IDocViewNode,
    IInlineViewNode,
    ILineViewNode,
    InlineViewNode,
    IPageViewNode,
    ITextViewNode,
    IViewNode,
    LineViewNode,
    PageViewNode,
    TextViewNode,
} from './node';

export class ViewTreeManager {
    protected doc: IDocViewNode | null = null;

    constructor(protected domService: DOMService) {}

    syncWithLayoutTree(layoutDoc: IDocLayoutNode) {
        this.doc = this.syncWithLayoutNode(this.doc, layoutDoc) as IDocViewNode;
        return this.doc;
    }

    protected syncWithLayoutNode(node: IViewNode | null, layoutNode: ILayoutNode) {
        if (!layoutNode.needDisplay && node) {
            return node;
        }
        let updatedNode: IViewNode;
        if (layoutNode.type === 'doc' && (!node || node.type === 'doc')) {
            updatedNode = this.syncWithDocLayoutNode(node, layoutNode);
        } else if (layoutNode.type === 'page' && (!node || node.type === 'page')) {
            updatedNode = this.syncWithPageLayoutNode(node, layoutNode);
        } else if (layoutNode.type === 'block' && (!node || node.type === 'block')) {
            updatedNode = this.syncWithBlockLayoutNode(node, layoutNode);
        } else if (layoutNode.type === 'line' && (!node || node.type === 'line')) {
            updatedNode = this.syncWithLineLayoutNode(node, layoutNode);
        } else if (layoutNode.type === 'text' && (!node || node.type === 'text')) {
            updatedNode = this.syncWithTextLayoutNode(node, layoutNode);
        } else if (layoutNode.type === 'inline' && (!node || node.type === 'inline')) {
            updatedNode = this.syncWithInlineLayoutNode(node, layoutNode);
        } else {
            throw new Error('Invalid view and layout node pair for syncing.');
        }
        this.syncLayoutWithLayoutNode(updatedNode, layoutNode);
        layoutNode.markAsDisplayed();
        return updatedNode;
    }

    protected syncWithDocLayoutNode(node: IDocViewNode | null, layoutNode: IDocLayoutNode) {
        if (!node) {
            node = new DocViewNode(layoutNode.id, this.domService);
            node.setLayout(layoutNode.layout);
        }
        this.syncWithLayoutNodeWithChildren(node, layoutNode);
        return node;
    }

    protected syncWithPageLayoutNode(node: IPageViewNode | null, layoutNode: IPageLayoutNode) {
        if (!node) {
            node = new PageViewNode(layoutNode.id, this.domService);
            node.setLayout(layoutNode.layout);
        }
        this.syncWithLayoutNodeWithChildren(node, layoutNode);
        return node;
    }

    protected syncWithBlockLayoutNode(node: IBlockViewNode | null, layoutNode: IBlockLayoutNode) {
        if (!node) {
            node = new BlockViewNode(layoutNode.id, this.domService);
            node.setLayout(layoutNode.layout);
        }
        this.syncWithLayoutNodeWithChildren(node, layoutNode);
        return node;
    }

    protected syncWithLineLayoutNode(node: ILineViewNode | null, layoutNode: ILineLayoutNode) {
        if (!node) {
            node = new LineViewNode(layoutNode.id, this.domService);
            node.setLayout(layoutNode.layout);
        }
        this.syncWithLayoutNodeWithChildren(node, layoutNode);
        return node;
    }

    protected syncWithTextLayoutNode(node: ITextViewNode | null, layoutNode: ITextLayoutNode) {
        if (!node) {
            node = new TextViewNode(layoutNode.id, this.domService);
            node.setLayout(layoutNode.layout);
        }
        const content = layoutNode.children.map((child) => child.content).join('');
        node.setContent(content);
        return node;
    }

    protected syncWithInlineLayoutNode(node: IInlineViewNode | null, layoutNode: IInlineLayoutNode) {
        if (!node) {
            node = new InlineViewNode(layoutNode.id, this.domService);
            node.setLayout(layoutNode.layout);
        }
        return node;
    }

    protected syncLayoutWithLayoutNode(node: IViewNode, layoutNode: ILayoutNode) {
        const layout = node.layout;
        const newLayout = layoutNode.layout;
        if (!testDeepEquality(layout, newLayout)) {
            node.setLayout(newLayout as any);
        }
    }

    protected identifyNode(node: IViewNode) {
        return node.id;
    }

    protected syncWithLayoutNodeWithChildren<TViewNodeChild extends IViewNode, TLayoutNodeChild extends ILayoutNode>(
        node: IViewNodeWithChildren<TViewNodeChild>,
        layoutNode: ILayoutNodeWithChildren<TLayoutNodeChild>,
    ) {
        const children = node.children;
        const layoutChildren = layoutNode.children;
        const childrenMap: { [key: string]: IViewNode } = {};
        children.forEach((child) => {
            childrenMap[child.layoutId] = child;
        });
        const newChildren: TViewNodeChild[] = [];
        layoutChildren.forEach((layoutChild) => {
            newChildren.push(this.syncWithLayoutNode(childrenMap[layoutChild.id] || null, layoutChild) as any);
        });
        if (!testDeepEquality(children.map(this.identifyNode), newChildren.map(this.identifyNode))) {
            node.setChildren(newChildren);
        }
    }
}

interface IViewNodeWithChildren<TViewNodeChild extends IViewNode> {
    readonly layoutId: string;
    readonly children: TViewNodeChild[];
    setChildren: (children: TViewNodeChild[]) => void;
}

interface ILayoutNodeWithChildren<TLayoutNodeChild extends ILayoutNode> {
    readonly children: TLayoutNodeChild[];
}
