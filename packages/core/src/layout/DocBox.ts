import RootNode from '../tree/RootNode';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import PageFlowBox from './PageFlowBox';
import DocRenderNode from '../render/DocRenderNode';

type Child = PageFlowBox;

export default class DocBox extends Box implements RootNode {
  protected children: Child[] = [];

  getWidth() {
    return 0;
  }

  getHeight() {
    return 0;
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

  onRenderUpdated(renderNode: DocRenderNode) {
    this.clearCache();
  }

  resolvePosition(selectableOffset: number) {
    const position = new Position(this, selectableOffset, undefined, (parent: Position) => {
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

  resolveViewportPositionToSelectableOffset(pageOffset: number, x: number, y: number) {
    if (pageOffset >= this.children.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    let selectableOffset = 0;
    for (let n = 0; n < pageOffset; n++) {
      selectableOffset += this.children[n].getSelectableSize();
    }
    return selectableOffset + this.children[pageOffset].resolveViewportPositionToSelectableOffset(x, y);
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number) {
    const viewportBoundingRects: ViewportBoundingRect[][] = [];
    this.children.forEach(() => {
      viewportBoundingRects.push([]);
    });
    let selectableOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn && selectableOffset <= to; n++) {
      const child = this.children[n];
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.max(from - selectableOffset, minChildOffset);
      const childTo = Math.min(to - selectableOffset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects[n].push(childViewportBoundingRect);
        });
      }
      selectableOffset += child.getSelectableSize();
    }
    return viewportBoundingRects;
  }
}
