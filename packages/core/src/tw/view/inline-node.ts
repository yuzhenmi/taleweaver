import { IInlineLayoutNode } from 'tw/layout/inline-node';
import { ILineViewNode } from 'tw/view/line-node';
import { IViewNode, IViewNodeClass, ViewNode } from 'tw/view/node';

export interface IInlineViewNode extends IViewNode<ILineViewNode, never> {}

export abstract class InlineViewNode<TLayoutNode extends IInlineLayoutNode> extends ViewNode<
    TLayoutNode,
    ILineViewNode,
    never
> {
    protected size?: number;

    getNodeClass(): IViewNodeClass {
        return 'inline';
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }
}
