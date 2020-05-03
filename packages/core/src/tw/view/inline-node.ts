import { ILayoutInline } from '../layout/inline';
import { ILineViewNode } from './line-node';
import { IViewNode, IViewNodeClass, ViewNode } from './node';

export interface IInlineViewNode<TLayoutNode extends ILayoutInline = ILayoutInline>
    extends IViewNode<TLayoutNode, ILineViewNode, never> {}

export abstract class InlineViewNode<TLayoutNode extends ILayoutInline = ILayoutInline>
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
