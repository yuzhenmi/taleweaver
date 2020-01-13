import { IDocLayoutNode } from '../layout/doc-node';
import { IViewNode, IViewNodeClass, ViewNode } from './node';
import { IPageViewNode } from './page-node';

export interface IDocViewNode<TLayoutNode extends IDocLayoutNode = IDocLayoutNode>
    extends IViewNode<TLayoutNode, never, IPageViewNode> {
    attach(domContainer: HTMLElement): void;
}

export abstract class DocViewNode<TLayoutNode extends IDocLayoutNode = IDocLayoutNode>
    extends ViewNode<TLayoutNode, never, IPageViewNode>
    implements IDocViewNode<TLayoutNode> {
    protected size?: number;
    protected attached = false;

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

    attach(domContainer: HTMLElement) {
        if (this.attached) {
            throw new Error('Already attached to the DOM.');
        }
        domContainer.appendChild(this.getDOMContainer());
        this.attached = true;
    }

    isAttached() {
        return this.attached;
    }
}
