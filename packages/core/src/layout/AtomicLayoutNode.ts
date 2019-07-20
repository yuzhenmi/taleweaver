import InlineNode from './InlineLayoutNode';
import LayoutNode, { LayoutPosition } from './LayoutNode';
import LayoutRect from './LayoutRect';

type ParentNode = InlineNode;

export default abstract class AtomicLayoutNode extends LayoutNode<ParentNode, never> {
  abstract getBreakable(): boolean;
  abstract getWidth(): number;
  abstract getWidthWithoutTrailingWhitespace(): number;
  abstract getHeight(): number;
  abstract clearCache(): void;
  abstract resolveLayoutRects(from: number, to: number): LayoutRect[];
  abstract resolveViewportPositionToSelectableOffset(x: number): number;
  abstract splitAtWidth(width: number): AtomicLayoutNode;
  abstract join(atomicNode: AtomicLayoutNode): void;

  isRoot() {
    return false;
  }

  isLeaf() {
    return true;
  }

  resolvePosition(offset: number, depth: number): LayoutPosition {
    return {
      node: this,
      depth,
      offset,
    };
  }
}
