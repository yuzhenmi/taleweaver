import Box from './Box';
import InlineBox from './InlineBox';

interface ViewportBoundingRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

type Child = InlineBox;

export default class LineBox extends Box {
  protected children: Child[];

  constructor() {
    super(0, 0, 0);
    this.children = [];
  }

  insertChild(child: Child, offset: number) {
    const childWidth = child.getWidth();
    const childHeight = child.getHeight();
    this.width += childWidth;
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
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.min(Math.max(from - selectableOffset, minChildOffset), maxChildOffset);
      const childTo = Math.min(Math.max(to - selectableOffset, minChildOffset), maxChildOffset);
      if (childFrom !== childTo) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects.push({
            left: cumulatedWidth,
            right: this.width - cumulatedWidth - childWidth,
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
    return viewportBoundingRects;
  }
}
