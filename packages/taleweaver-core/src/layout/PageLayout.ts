import BlockBox from './BlockBox';
import ViewportBoundingRect from './ViewportBoundingRect';

type Child = BlockBox;

const PAGE_HEIGHT_PLACEHOLDER = 880;

export default class PageLayout {
  protected children: Child[];
  protected selectableSize: number;

  constructor() {
    this.children = [];
    this.selectableSize = 0;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getSelectableSize(): number {
    return this.selectableSize;
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
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childHeight = child.getHeight();
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.min(Math.max(from - selectableOffset, minChildOffset), maxChildOffset);
      const childTo = Math.min(Math.max(to - selectableOffset, minChildOffset), maxChildOffset);
      if (childFrom !== childTo) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects.push({
            left: childViewportBoundingRect.left + 60,
            right: childViewportBoundingRect.right + 60,
            top: cumulatedHeight + childViewportBoundingRect.top + 60,
            bottom: PAGE_HEIGHT_PLACEHOLDER - cumulatedHeight - childHeight + childViewportBoundingRect.bottom + 60,
            width: childViewportBoundingRect.width,
            height: childHeight,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedHeight += childHeight;
    }
    return viewportBoundingRects;
  }
}
