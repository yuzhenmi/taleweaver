import { ILayoutBlock } from '../layout/block';
import { ILineViewNode } from './line-node';
import { IViewNode, IViewNodeClass, ViewNode } from './node';
import { IPageViewNode } from './page-node';

export interface IBlockViewNode<TLayoutNode extends ILayoutBlock = ILayoutBlock>
    extends IViewNode<TLayoutNode, IPageViewNode, ILineViewNode> {}

export abstract class BlockViewNode<TLayoutNode extends ILayoutBlock = ILayoutBlock>
    extends ViewNode<TLayoutNode, IPageViewNode, ILineViewNode>
    implements IBlockViewNode<TLayoutNode> {
    protected size?: number;

    getNodeClass(): IViewNodeClass {
        return 'block';
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
