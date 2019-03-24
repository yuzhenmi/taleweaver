import Box from './Box';
import InlineBox from './InlineBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import LayoutNode from './LayoutNode';

type Parent = InlineBox;

export default abstract class AtomicBox extends Box {
  protected parent?: Parent;
  protected breakable: boolean;

  constructor(renderNodeID: string, breakable: boolean) {
    super(renderNodeID);
    this.breakable = breakable;
  }

  getChildren(): LayoutNode[] {
    return [];
  }

  insertChild(child: LayoutNode, offset: number) {
    throw new Error('Cannot insert child to atomic box.');
  }

  deleteChild(child: LayoutNode) {
    throw new Error('Cannot delete child from atomic box.');
  }

  isBreakable(): boolean {
    return this.breakable;
  }

  setParent(parent: Parent) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Atomic box has parent set.`);
    }
    return this.parent;
  }

  getPreviousSibling(): AtomicBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Atomic box is not found in parent.`);
    }
    if (offset > 0) {
      return siblings[offset - 1];
    }
    const parentPreviousSibling = this.getParent().getPreviousSibling();
    if (!parentPreviousSibling) {
      return null;
    }
    const parentPreviousSiblingChildren = parentPreviousSibling.getChildren();
    return parentPreviousSiblingChildren[parentPreviousSiblingChildren.length - 1];
  }

  getNextSibling(): AtomicBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Atomic box is not found in parent.`);
    }
    if (offset < siblings.length - 1) {
      return siblings[offset + 1];
    }
    const parentNextSibling = this.getParent().getNextSibling();
    if (!parentNextSibling) {
      return null;
    }
    const parentNextSiblingChildren = parentNextSibling.getChildren();
    return parentNextSiblingChildren[0];
  }

  resolvePosition(parentPosition: Position, selectableOffset: number): Position {
    const position = new Position(this, selectableOffset, parentPosition);
    return position;
  }

  abstract resolveViewportPositionToSelectableOffset(x: number): number;

  abstract resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[];
}
