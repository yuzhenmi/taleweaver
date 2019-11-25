import { IInlineLayoutNode } from 'tw/layout/inline-node';
import { ILayoutNode, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { ILineLayoutNode } from './line-node';

export interface IInlineLayoutNode extends ILayoutNode<ILineLayoutNode, never> {}

export abstract class InlineLayoutNode extends LayoutNode<ILineLayoutNode, never> implements IInlineLayoutNode {
    protected size?: number;

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    resolvePosition(offset: number, depth: number): ILayoutPosition {
        if (offset >= this.getSize()) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        const position = new LayoutPosition(this, depth, offset);
        return position;
    }

    clearOwnCache() {
        this.size = undefined;
    }
}
