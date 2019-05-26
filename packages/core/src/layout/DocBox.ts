import RootNode from '../tree/RootNode';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import PageFlowBox from './PageFlowBox';
import DocRenderNode from '../render/DocRenderNode';

type Child = PageFlowBox;

export default class DocBox extends Box implements RootNode {
  protected configWidth: number;
  protected configHeight: number;
  protected paddingTop: number;
  protected paddingBottom: number;
  protected paddingLeft: number;
  protected paddingRight: number;
  protected children: Child[] = [];

  constructor(renderNodeID: string) {
    super(renderNodeID);
    this.configWidth = 0;
    this.configHeight = 0;
    this.paddingTop = 0;
    this.paddingBottom = 0;
    this.paddingLeft = 0;
    this.paddingRight = 0;
  }

  setVersion(version: number) {
    if (this.version < version) {
      this.version = version;
    }
  }

  getWidth(): number {
    return this.configWidth;
  }

  getHeight(): number {
    return this.configHeight;
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

  onRenderUpdated(renderNode: DocRenderNode) {
    this.configWidth = renderNode.getWidth();
    this.configHeight = renderNode.getHeight();
    this.paddingTop = renderNode.getPadding();
    this.paddingBottom = renderNode.getPadding();
    this.paddingLeft = renderNode.getPadding();
    this.paddingRight = renderNode.getPadding();
    this.clearCache();
  }

  resolvePosition(selectableOffset: number): Position {
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

  resolveViewportPositionToSelectableOffset(pageOffset: number, x: number, y: number): number {
    if (pageOffset >= this.children.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    let selectableOffset = 0;
    for (let n = 0; n < pageOffset; n++) {
      selectableOffset += this.children[n].getSelectableSize();
    }
    return selectableOffset + this.children[pageOffset].resolveViewportPositionToSelectableOffset(x, y);
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[][] {
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
