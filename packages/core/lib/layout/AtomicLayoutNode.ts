import InlineNode from './InlineLayoutNode';
import LayoutNode from './LayoutNode';
import LayoutPosition from './LayoutPosition';
import Rect from './LayoutRect';

type ParentNode = InlineNode;

export default abstract class AtomicLayoutNode extends LayoutNode<ParentNode, never> {
    abstract getBreakable(): boolean;
    abstract getWidth(): number;
    abstract getWidthWithoutTrailingWhitespace(): number;
    abstract getHeight(): number;
    abstract clearCache(): void;
    abstract resolveRects(from: number, to: number): Rect[];
    abstract convertCoordinatesToOffset(x: number): number;
    abstract splitAtWidth(width: number): AtomicLayoutNode;
    abstract join(atomicNode: AtomicLayoutNode): void;

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    resolvePosition(offset: number, depth: number): LayoutPosition {
        return new LayoutPosition(this, depth, offset);
    }
}
