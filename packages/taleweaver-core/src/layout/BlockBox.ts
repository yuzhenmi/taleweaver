import Box from './Box';
import LineBox from './LineBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import PageLayout from './PageLayout';

type Parent = PageLayout;
type Child = LineBox;

export default abstract class BlockBox extends Box {
  protected parent?: Parent;
  protected children: Child[];

  constructor() {
    super(0, 680, 0);
    this.children = [];
  }

  abstract getType(): string;

  setParent(parent: Parent) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Block box has parent set.`);
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number) {
    const childHeight = child.getHeight();
    this.height = this.height + childHeight;
    this.children.splice(offset, 0, child);
    child.setParent(this);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getPreviousSibling(): BlockBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Block box is not found in parent.`);
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

  getNextSibling(): BlockBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Block box is not found in parent.`);
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
    const position = new Position(this, selectableOffset, parentPosition, (parent: Position) => {
      let cumulatedSelectableOffset = 0;
      for (let n = 0, nn = this.children.length; n < nn; n++) {
        const child = this.children[n];
        const childSelectableSize = child.getSelectableSize();
        if (cumulatedSelectableOffset + childSelectableSize > selectableOffset) {
          const childPosition = child.resolvePosition(parent, selectableOffset - cumulatedSelectableOffset);
          return childPosition;
        }
        cumulatedSelectableOffset += childSelectableSize;
      }
      throw new Error(`Selectable offset ${selectableOffset} cannot be resolved to position.`);
    });
    return position;
  }

  abstract cutAt(offset: number): BlockBox;

  abstract resolveViewportPositionToSelectableOffset(x: number, y: number): number;

  abstract resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[];
}
