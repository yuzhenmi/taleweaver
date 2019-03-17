import mergeViewportBoundingRects from './helpers/mergeViewportBoundingRects';
import Box from './Box';
import BlockBox from './BlockBox';
import InlineBox from './InlineBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';

type Parent = BlockBox;
type Child = InlineBox;

export default class LineBox extends Box {
  protected parent?: Parent;
  protected children: Child[];

  constructor() {
    super(0, 680, 0);
    this.children = [];
  }

  setParent(parent: Parent) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Line box has parent set.`);
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number) {
    const childHeight = child.getHeight();
    this.height = Math.max(this.height, childHeight);
    this.children.splice(offset, 0, child);
    child.setParent(this);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getPreviousSibling(): LineBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Line box is not found in parent.`);
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

  getNextSibling(): LineBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Line box is not found in parent.`);
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

  resolveViewportPositionToSelectableOffset(x: number): number {
    let selectableOffset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
        selectableOffset += child.resolveViewportPositionToSelectableOffset(x - cumulatedWidth);
        break;
      }
      selectableOffset += child.getSelectableSize();
      cumulatedWidth += childWidth;
    }
    if (selectableOffset === this.selectableSize) {
      return selectableOffset - 1;
    }
    return selectableOffset;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    const viewportBoundingRects: ViewportBoundingRect[] = [];
    let selectableOffset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.children.length; n < nn && selectableOffset <= to; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.max(from - selectableOffset, minChildOffset);
      const childTo = Math.min(to - selectableOffset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset && !(childFrom === childTo && childTo === maxChildOffset)) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects.push({
            left: cumulatedWidth + childViewportBoundingRect.left,
            right: this.width - cumulatedWidth - childWidth + childViewportBoundingRect.right,
            top: 0,
            bottom: 0,
            width: childViewportBoundingRect.width,
            height: this.height,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedWidth += childWidth;
    }
    mergeViewportBoundingRects(viewportBoundingRects);
    return viewportBoundingRects;
  }
}
