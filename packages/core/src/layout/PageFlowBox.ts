import DocBox from './DocBox';
import BlockBox from './BlockBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import FlowBox from './FlowBox';

type Parent = DocBox;
type Child = BlockBox;

export default class PageFlowBox extends FlowBox {
  protected configWidth: number;
  protected configHeight: number;
  protected padding: number;
  protected parent: Parent | null = null;
  protected children: Child[] = [];

  constructor(width: number, height: number, padding: number) {
    super();
    this.configWidth = width;
    this.configHeight = height;
    this.padding = padding;
  }

  getWidth(): number {
    return this.configWidth;
  }

  getHeight(): number {
    return this.configHeight;
  }

  getPadding(): number {
    return this.padding;
  }

  getInnerWidth(): number {
    return this.getWidth() - this.getPadding() * 2;
  }

  getInnerHeight(): number {
    return this.getHeight() - this.getPadding() * 2;
  }

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Page flow box has no parent set.`);
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number | null = null) {
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
    } else {
      this.children.splice(offset, 0, child);
    }
    this.clearCache();
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.setParent(null);
    child.markAsDeleted();
    this.children.splice(childOffset, 1);
    this.clearCache();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getPreviousSibling(): PageFlowBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Page flow box is not found in parent.`);
    }
    if (offset > 0) {
      return siblings[offset - 1];
    }
    return null;
  }

  getNextSibling(): PageFlowBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Page flow box is not found in parent.`);
    }
    if (offset < siblings.length - 1) {
      return siblings[offset + 1];
    }
    return null;
  }

  getSelectableSize(): number {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
  }

  onRenderUpdated() {
    this.clearCache();
  }

  splitAt(offset: number): PageFlowBox {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving PageFlowBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newPageFlowBox = new PageFlowBox(this.configWidth, this.configHeight, this.padding);
    childrenCut.forEach((child, childOffset) => {
      newPageFlowBox.insertChild(child, childOffset);
    });
    this.clearCache();
    return newPageFlowBox;
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
    const innerX = Math.min(Math.max(x - this.getPadding(), 0), this.getWidth() - this.getPadding());
    const innerY = Math.min(Math.max(y - this.getPadding(), 0), this.getHeight() - this.getPadding());
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childHeight = child.getHeight();
      if (innerY >= cumulatedHeight && innerY <= cumulatedHeight + childHeight) {
        selectableOffset += child.resolveViewportPositionToSelectableOffset(innerX, innerY - cumulatedHeight);
        break;
      }
      selectableOffset += child.getSelectableSize();
      cumulatedHeight += childHeight;
    }
    if (selectableOffset === this.getSelectableSize()) {
      const lastChild = this.children[this.children.length - 1];
      selectableOffset -= lastChild.getSelectableSize();
      selectableOffset += lastChild.resolveViewportPositionToSelectableOffset(innerX, lastChild.getHeight());
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
            left: childViewportBoundingRect.left + this.getPadding(),
            right: childViewportBoundingRect.right + this.getPadding(),
            top: cumulatedHeight + childViewportBoundingRect.top + this.getPadding(),
            bottom: this.getHeight() - cumulatedHeight - childHeight + childViewportBoundingRect.bottom + this.getPadding(),
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
