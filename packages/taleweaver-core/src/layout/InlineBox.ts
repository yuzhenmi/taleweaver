import Box from './Box';
import AtomicBox from './AtomicBox';
import ViewportBoundingRect from './ViewportBoundingRect';

type Child = AtomicBox;

export default abstract class InlineBox extends Box {
  protected children: Child[];

  constructor() {
    super(0, 0, 0);
    this.children = [];
  }

  abstract getType(): string;

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

  abstract cutAt(offset: number): InlineBox;

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
    for (let n = 0, nn = this.children.length; n < nn && selectableOffset < to; n++) {
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
