import { IDocLayoutNode } from 'tw/layout/doc-node';
import { IViewNode, IViewNodeClass, ViewNode } from 'tw/view/node';
import { IPageViewNode } from 'tw/view/page-node';

export interface IDocViewNode extends IViewNode<never, IPageViewNode> {}

export abstract class DocViewNode<TLayoutNode extends IDocLayoutNode>
    extends ViewNode<TLayoutNode, never, IPageViewNode>
    implements IDocViewNode {
    protected size?: number;

    getNodeClass(): IViewNodeClass {
        return 'doc';
    }

    isRoot() {
        return true;
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
