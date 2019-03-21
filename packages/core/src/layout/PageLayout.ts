import DocLayout from './DocLayout';
import BlockBox from './BlockBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import LayoutNode from './LayoutNode';

type Parent = DocLayout;
type Child = BlockBox;

const PAGE_HEIGHT_PLACEHOLDER = 880;

export default class PageLayout extends LayoutNode {
  protected parent?: Parent;
  protected children: Child[];

  constructor() {
    super(0);
    this.children = [];
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }

  setParent(parent: Parent) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Page layout has parent set.`);
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    child.setParent(this);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getPreviousSibling(): PageLayout | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Page layout is not found in parent.`);
    }
    if (offset > 0) {
      return siblings[offset - 1];
    }
    return null;
  }

  getNextSibling(): PageLayout | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Page layout is not found in parent.`);
    }
    if (offset < siblings.length - 1) {
      return siblings[offset + 1];
    }
    return null;
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

  resolveViewportPositionToSelectableOffset(x: number, y: number): number {
    let selectableOffset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childHeight = child.getHeight();
      if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
        selectableOffset += child.resolveViewportPositionToSelectableOffset(x, y - cumulatedHeight);
        break;
      }
      selectableOffset += child.getSelectableSize();
      cumulatedHeight += childHeight;
    }
    return selectableOffset;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    const viewportBoundingRects: ViewportBoundingRect[] = [];
    let selectableOffset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.children.length; n < nn && selectableOffset <= to; n++) {
      const child = this.children[n];
      const childHeight = child.getHeight();
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.max(from - selectableOffset, minChildOffset);
      const childTo = Math.min(to - selectableOffset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects.push({
            left: childViewportBoundingRect.left + 60,
            right: childViewportBoundingRect.right + 60,
            top: cumulatedHeight + childViewportBoundingRect.top + 60,
            bottom: PAGE_HEIGHT_PLACEHOLDER - cumulatedHeight - childHeight + childViewportBoundingRect.bottom + 60,
            width: childViewportBoundingRect.width,
            height: childViewportBoundingRect.height,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedHeight += childHeight;
    }
    return viewportBoundingRects;
  }
}
