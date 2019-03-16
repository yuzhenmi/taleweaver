import Box from './Box';
import InlineBox from './InlineBox';
import ViewportBoundingRect from './ViewportBoundingRect';
import mergeViewportBoundingRects from './helpers/mergeViewportBoundingRects';

type Child = InlineBox;

export default class LineBox extends Box {
  protected children: Child[];

  constructor() {
    super(0, 680, 0);
    this.children = [];
  }

  insertChild(child: Child, offset: number) {
    const childHeight = child.getHeight();
    this.height = Math.max(this.height, childHeight);
    this.children.splice(offset, 0, child);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

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
          viewportBoundingRects.push({
            left: cumulatedWidth + childViewportBoundingRect.left,
            right: this.width - cumulatedWidth - childWidth + childViewportBoundingRect.right,
            top: 0,
            bottom: 0,
            width: childViewportBoundingRect.width,
            height: this.height,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedWidth += childWidth;
    }
    mergeViewportBoundingRects(viewportBoundingRects);
    return viewportBoundingRects;
  }
}
