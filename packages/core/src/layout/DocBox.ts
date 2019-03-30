import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import PageFlowBox from './PageFlowBox';
import DocRenderNode from '../render/DocRenderNode';

type Child = PageFlowBox;

type OnUpdatedSubscriber = () => void;

export default class DocBox extends Box {
  protected version: number;
  protected width: number;
  protected height: number;
  protected padding: number;
  protected children: Child[];
  protected selectableSize?: number;
  protected onUpdatedSubscribers: OnUpdatedSubscriber[];

  constructor(renderNodeID: string) {
    super(renderNodeID);
    this.version = 0;
    this.width = 0;
    this.height = 0;
    this.padding = 0;
    this.children = [];
    this.onUpdatedSubscribers = [];
  }

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getPadding(): number {
    return this.padding;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    child.setParent(this);
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    this.children.splice(childOffset, 1);
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
    this.width = renderNode.getWidth();
    this.height = renderNode.getHeight();
    this.padding = renderNode.getPadding();
  }

  subscribeOnUpdated(onUpdatedSubscriber: OnUpdatedSubscriber) {
    this.onUpdatedSubscribers.push(onUpdatedSubscriber);
  }

  onUpdated() {
    this.onUpdatedSubscribers.forEach(onUpdatedSubscriber => {
      onUpdatedSubscriber();
    });
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
          viewportBoundingRects[n].push({
            left: childViewportBoundingRect.left,
            right: childViewportBoundingRect.right,
            top: childViewportBoundingRect.top,
            bottom: childViewportBoundingRect.bottom,
            width: childViewportBoundingRect.width,
            height: childViewportBoundingRect.height,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
    }
    return viewportBoundingRects;
  }
}
