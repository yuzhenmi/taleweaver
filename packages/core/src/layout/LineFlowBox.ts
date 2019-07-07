import Editor from '../Editor';
import mergeViewportBoundingRects from './utils/mergeViewportBoundingRects';
import FlowBox from './FlowBox';
import BlockBox from './BlockBox';
import InlineBox from './InlineBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';

type Parent = BlockBox;
type Child = InlineBox;

export default class LineFlowBox extends FlowBox {
  protected width: number;
  protected height?: number;
  protected parent: Parent | null = null;
  protected children: Child[] = [];

  constructor(editor: Editor, width: number) {
    super(editor);
    this.width = width;
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
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
    return 0;
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

  getParent() {
    if (!this.parent) {
      throw new Error(`Line box has no parent set.`);
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

  getChildren() {
    return this.children;
  }

  getPreviousSibling() {
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

  getNextSibling() {
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

  getSize() {
    if (this.size === undefined) {
      let size = 0;
      this.children.forEach(child => {
        size += child.getSize();
      });
      this.size = size;
    }
    return this.size;
  }

  onRenderUpdated() {
    this.clearCache();
  }

  splitAt(offset: number) {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving LineFlowBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newLineFlowBox = new LineFlowBox(this.editor, this.getWidth());
    childrenCut.forEach((child, childOffset) => {
      newLineFlowBox.insertChild(child, childOffset);
    });
    this.clearCache();
    return newLineFlowBox;
  }

  resolvePosition(parentPosition: Position, offset: number) {
    const position = new Position(this, offset, parentPosition, (parent: Position) => {
      let cumulatedSelectableOffset = 0;
      for (let n = 0, nn = this.children.length; n < nn; n++) {
        const child = this.children[n];
        const childSelectableSize = child.getSize();
        if (cumulatedSelectableOffset + childSelectableSize > offset) {
          const childPosition = child.resolvePosition(parent, offset - cumulatedSelectableOffset);
          return childPosition;
        }
        cumulatedSelectableOffset += childSelectableSize;
      }
      throw new Error(`Offset ${offset} cannot be resolved to position.`);
    });
    return position;
  }

  resolveViewportPositionToSelectableOffset(x: number) {
    let offset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
        offset += child.resolveViewportPositionToSelectableOffset(x - cumulatedWidth);
        break;
      }
      offset += child.getSize();
      cumulatedWidth += childWidth;
    }
    if (offset === this.size) {
      return offset - 1;
    }
    return offset;
  }

  resolveOffsetRangeToViewportBoundingRects(from: number, to: number) {
    const viewportBoundingRects: ViewportBoundingRect[] = [];
    let offset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.children.length; n < nn && offset <= to; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      const minChildOffset = 0;
      const maxChildOffset = child.getSize();
      const childFrom = Math.max(from - offset, minChildOffset);
      const childTo = Math.min(to - offset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset && !(childFrom === childTo && childTo === maxChildOffset)) {
        const childViewportBoundingRects = child.resolveOffsetRangeToViewportBoundingRects(childFrom, childTo);
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
            paddingTop: childViewportBoundingRect.paddingTop,
            paddingBottom: childViewportBoundingRect.paddingBottom,
            paddingLeft: 0,
            paddingRight: 0,
          });
        });
      }
      offset += child.getSize();
      cumulatedWidth += childWidth;
    }
    mergeViewportBoundingRects(viewportBoundingRects);
    return viewportBoundingRects;
  }

  protected clearCache() {
    super.clearCache();
    this.height = undefined;
  }
}
