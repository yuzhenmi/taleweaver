import { IPageLayoutNode } from 'tw/layout/page-node';
import { IBlockViewNode } from 'tw/view/block-node';
import { IDocViewNode } from 'tw/view/doc-node';
import { IViewNode, IViewNodeClass, ViewNode } from 'tw/view/node';

export interface IPageViewNode<TLayoutNode extends IPageLayoutNode = IPageLayoutNode>
    extends IViewNode<TLayoutNode, IDocViewNode, IBlockViewNode> {}

export abstract class PageViewNode<TLayoutNode extends IPageLayoutNode = IPageLayoutNode>
    extends ViewNode<TLayoutNode, IDocViewNode, IBlockViewNode>
    implements IPageViewNode<TLayoutNode> {
    protected size?: number;

    getNodeClass(): IViewNodeClass {
        return 'page';
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
