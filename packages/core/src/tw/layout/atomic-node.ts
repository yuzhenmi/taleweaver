import { IInlineLayoutNode } from './inline-node';
import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from './node';
import { ILayoutRect } from './rect';

export interface IAtomicLayoutNode extends ILayoutNode<IInlineLayoutNode, never> {
    getTailTrimmedWidth(): number;
    breakAtWidth(width: number): IAtomicLayoutNode;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export abstract class AtomicLayoutNode extends LayoutNode<IInlineLayoutNode, never> implements IAtomicLayoutNode {
    abstract getTailTrimmedWidth(): number;
    abstract breakAtWidth(width: number): IAtomicLayoutNode;
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

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
