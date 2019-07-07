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

  onRenderUpdated(renderNode: DocRenderNode) {
    this.clearCache();
  }

  resolvePosition(offset: number) {
    const position = new Position(this, offset, undefined, (parent: Position) => {
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

  resolveOffsetRangeToViewportBoundingRects(from: number, to: number) {
    const viewportBoundingRects: ViewportBoundingRect[][] = [];
    this.children.forEach(() => {
      viewportBoundingRects.push([]);
    });
    let offset = 0;
    for (let n = 0, nn = this.children.length; n < nn && offset <= to; n++) {
      const child = this.children[n];
      const minChildOffset = 0;
      const maxChildOffset = child.getSize();
      const childFrom = Math.max(from - offset, minChildOffset);
      const childTo = Math.min(to - offset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childViewportBoundingRects = child.resolveOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects[n].push(childViewportBoundingRect);
        });
      }
      offset += child.getSize();
    }
    return viewportBoundingRects;
  }
}
