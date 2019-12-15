import { ILineLayoutNode } from 'tw/layout/line-node';
import { IBlockViewNode } from 'tw/view/block-node';
import { IInlineViewNode } from 'tw/view/inline-node';
import { IViewNode, IViewNodeClass, ViewNode } from 'tw/view/node';

export interface ILineViewNode<TLayoutNode extends ILineLayoutNode = ILineLayoutNode>
    extends IViewNode<TLayoutNode, IBlockViewNode, IInlineViewNode> {}

export class LineViewNode<TLayoutNode extends ILineLayoutNode = ILineLayoutNode>
    extends ViewNode<TLayoutNode, IBlockViewNode, IInlineViewNode>
    implements ILineViewNode<TLayoutNode> {
    protected size?: number;
    protected domContainer: HTMLDivElement;

    constructor(layoutNode: TLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('div');
    }

    getNodeClass(): IViewNodeClass {
        return 'line';
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildren().reduce((size, child) => size + child.getSize(), 0);
        }
        return this.size;
    }

    clearOwnCache() {
        this.size = undefined;
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
    }
}
