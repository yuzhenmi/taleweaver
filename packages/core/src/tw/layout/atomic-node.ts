import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from 'tw/layout/node';
import { IInlineLayoutNode } from './inline-node';

export interface IAtomicLayoutNode extends ILayoutNode<IInlineLayoutNode, never> {
    getTailTrimmedWidth(): number;
}

export abstract class AtomicLayoutNode extends LayoutNode<IInlineLayoutNode, never> implements IAtomicLayoutNode {
    abstract getTailTrimmedWidth(): number;

    getNodeClass(): ILayoutNodeClass {
        return 'atomic';
    }

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    resolvePosition(offset: number, depth: number): ILayoutPosition {
        if (offset >= this.getSize()) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        const position = new LayoutPosition(this, depth, offset);
        return position;
    }

    clearOwnCache() {}
}
