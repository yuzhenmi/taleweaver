import { ILineLayoutNode } from 'tw/layout/line-node';
import { IBlockViewNode } from 'tw/view/block-node';
import { IInlineViewNode } from 'tw/view/inline-node';
import { IViewNode, IViewNodeClass, ViewNode } from 'tw/view/node';

export interface ILineViewNode extends IViewNode<IBlockViewNode, IInlineViewNode> {}

export class LineViewNode extends ViewNode<ILineLayoutNode, IBlockViewNode, IInlineViewNode> implements ILineViewNode {
    protected size?: number;

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
}
