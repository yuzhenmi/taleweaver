import Editor from '../Editor';
import DocBox from './DocBox';
import BlockBox from './BlockBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import FlowBox from './FlowBox';

type Parent = DocBox;
type Child = BlockBox;

export default class PageFlowBox extends FlowBox {
  protected width: number;
  protected height: number;
  protected paddingTop: number;
  protected paddingBottom: number;
  protected paddingLeft: number;
  protected paddingRight: number;
  protected parent: Parent | null = null;
  protected children: Child[] = [];

  constructor(editor: Editor) {
    super(editor);
    const pageConfig = editor.getConfig().getPageConfig();
    this.width = pageConfig.getPageWidth();
    this.height = pageConfig.getPageHeight();
    this.paddingTop = pageConfig.getPagePaddingTop();
    this.paddingBottom = pageConfig.getPagePaddingBottom();
    this.paddingLeft = pageConfig.getPagePaddingLeft();
    this.paddingRight = pageConfig.getPagePaddingRight();
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }

  getPaddingTop() {
    return this.paddingTop;
  }

  getPaddingBottom() {
    return this.paddingBottom;
  }

  getPaddingLeft() {
    return this.paddingLeft;
  }

  getPaddingRight() {
    return this.paddingRight;
  }

  getInnerWidth() {
    return this.width - this.paddingLeft - this.paddingRight;
  }

  getInnerHeight() {
    return this.height - this.paddingTop - this.paddingBottom;
  }

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
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

  getChildren() {
    return this.children;
  }

  getPreviousSibling() {
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

  getNextSibling() {
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

  getSelectableSize() {
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

  splitAt(offset: number) {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving PageFlowBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newPageFlowBox = new PageFlowBox(this.editor);
    childrenCut.forEach((child, childOffset) => {
      newPageFlowBox.insertChild(child, childOffset);
    });
    this.clearCache();
    return newPageFlowBox;
  }

  resolvePosition(parentPosition: Position, selectableOffset: number) {
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

  resolveViewportPositionToSelectableOffset(x: number, y: number) {
    let selectableOffset = 0;
    let cumulatedHeight = 0;
    const innerX = Math.min(Math.max(x - this.getPaddingLeft(), 0), this.getWidth() - this.getPaddingRight());
    const innerY = Math.min(Math.max(y - this.getPaddingTop(), 0), this.getHeight() - this.getPaddingBottom());
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
    if (selectableOffset === this.getSelectableSize()) {
      selectableOffset--;
    }
    return selectableOffset;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number) {
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
          const width = childViewportBoundingRect.width;
          const height = childViewportBoundingRect.height;
          const paddingTop = this.getPaddingTop();
          const paddingBottom = this.getPaddingBottom();
          const paddingLeft = this.getPaddingLeft();
          const paddingRight = this.getPaddingRight();
          const left = paddingLeft + childViewportBoundingRect.left;
          const right = paddingRight + childViewportBoundingRect.right;
          const top = cumulatedHeight + paddingTop + childViewportBoundingRect.top;
          const bottom = this.getHeight() - cumulatedHeight - childHeight - childViewportBoundingRect.bottom - paddingBottom;
          viewportBoundingRects.push({
            width,
            height,
            left,
            right,
            top,
            bottom,
            paddingTop: childViewportBoundingRect.paddingTop,
            paddingBottom: childViewportBoundingRect.paddingBottom,
            paddingLeft: childViewportBoundingRect.paddingLeft,
            paddingRight: childViewportBoundingRect.paddingRight,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedHeight += childHeight;
    }
    return viewportBoundingRects;
  }
}
