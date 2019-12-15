import { IInlineLayoutNode } from 'tw/layout/inline-node';
import { ILineViewNode } from 'tw/view/line-node';
import { IViewNode, IViewNodeClass, ViewNode } from 'tw/view/node';

export interface IInlineViewNode<TLayoutNode extends IInlineLayoutNode = IInlineLayoutNode>
    extends IViewNode<TLayoutNode, ILineViewNode, never> {}

export abstract class InlineViewNode<TLayoutNode extends IInlineLayoutNode = IInlineLayoutNode>
    extends ViewNode<TLayoutNode, ILineViewNode, never>
    implements IInlineViewNode<TLayoutNode> {
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
