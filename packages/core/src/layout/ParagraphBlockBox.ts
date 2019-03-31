import BlockBox from './BlockBox';
import ViewportBoundingRect from './ViewportBoundingRect';

export default class ParagraphBlockBox extends BlockBox {

  getType(): string {
    return 'ParagraphBlockBox';
  }

  cleaveAt(offset: number): ParagraphBlockBox {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving ParagraphBlockBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newParagraphBlockBox = new ParagraphBlockBox(this.renderNodeID);
    childrenCut.forEach((child, childOffset) => {
      newParagraphBlockBox.insertChild(child, childOffset);
    });
    this.height = undefined;
    this.selectableSize = undefined;
    return newParagraphBlockBox;
  }

  resolveViewportPositionToSelectableOffset(x: number, y: number): number {
    let selectableOffset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childHeight = child.getHeight();
      if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
        selectableOffset += child.resolveViewportPositionToSelectableOffset(x);
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
          viewportBoundingRects.push({
            left: childViewportBoundingRect.left,
            right: childViewportBoundingRect.right,
            top: cumulatedHeight + childViewportBoundingRect.top,
            bottom: this.getHeight() - cumulatedHeight - childHeight + childViewportBoundingRect.bottom,
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
