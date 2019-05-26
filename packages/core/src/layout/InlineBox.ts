import InlineRenderNode from '../render/InlineRenderNode';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import LineFlowBox from './LineFlowBox';
import AtomicBox from './AtomicBox';

type Parent = LineFlowBox;
type Child = AtomicBox;

export default abstract class InlineBox extends Box {
  protected widthWithoutTrailingWhitespace?: number;
  protected parent: Parent | null = null;
  protected children: Child[] = [];

  abstract getType(): string;

  setVersion(version: number) {
    if (this.version < version) {
      this.version = version;
      if (this.parent) {
        this.parent.setVersion(version);
      }
    }
  }

  getWidth(): number {
    if (this.width === undefined) {
      let width = 0;
      this.getChildren().forEach(child => {
        width += child.getWidth();
      });
      this.width = width;
    }
    return this.width;
  }

  getWidthWithoutTrailingWhitespace(): number {
    if (this.widthWithoutTrailingWhitespace === undefined) {
      const lastChild = this.children[this.children.length - 1];
      this.widthWithoutTrailingWhitespace = this.getWidth() - lastChild.getWidth() + lastChild.getWidthWithoutTrailingWhitespace();
    }
    return this.widthWithoutTrailingWhitespace;
  }

  getHeight(): number {
    if (this.height === undefined) {
      let height = 0;
      this.getChildren().forEach(child => {
        const childHeight = child.getPaddingTop() + child.getHeight() + child.getPaddingBottom();
        if (childHeight > height) {
          height = childHeight;
        }
      });
      this.height = height;
    }
    return this.height;
  }

  getPaddingTop() {
    return 0;
  }

  getPaddingBottom() {
    return 9;
  }

  getPaddingLeft() {
    return 0;
  }

  getPaddingRight() {
    return 0;
  }

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Inline box has no parent set.`);
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

  getPreviousSibling(): InlineBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Inline box is not found in parent.`);
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

  getNextSibling(): InlineBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Inline box is not found in parent.`);
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

  onRenderUpdated(renderNode: InlineRenderNode) {
    this.clearCache();
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

  abstract splitAt(offset: number): InlineBox;

  abstract join(inlineBox: InlineBox): void;

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
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          const width = childViewportBoundingRect.width;
          const height = childViewportBoundingRect.height;
          const paddingTop = this.getPaddingTop();
          const paddingBottom = this.getPaddingBottom();
          const paddingLeft = this.getPaddingLeft();
          const paddingRight = this.getPaddingRight();
          const left = cumulatedWidth + paddingLeft + childViewportBoundingRect.left;
          const right = this.getWidth() - cumulatedWidth - childViewportBoundingRect.right - paddingRight;
          const top = paddingTop + childViewportBoundingRect.top;
          const bottom = paddingBottom + childViewportBoundingRect.bottom;
          viewportBoundingRects.push({
            width,
            height,
            left,
            right,
            top,
            bottom,
            paddingTop,
            paddingBottom,
            paddingLeft: 0,
            paddingRight: 0,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedWidth += childWidth;
    }
    return viewportBoundingRects;
  }

  protected clearCache() {
    super.clearCache();
    this.widthWithoutTrailingWhitespace = undefined;
  }
}
