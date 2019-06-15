import BlockBox from './BlockBox';
import ViewportBoundingRect from './ViewportBoundingRect';

export default class ParagraphBlockBox extends BlockBox {

  getPaddingTop() {
    return 0;
  }

  getPaddingBottom() {
    return 12;
  }

  getPaddingLeft() {
    return 0;
  }

  getPaddingRight() {
    return 0;
  }

  getType(): string {
    return 'ParagraphBlockBox';
  }

  splitAt(offset: number) {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving ParagraphBlockBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newParagraphBlockBox = new ParagraphBlockBox(this.editor, this.renderNodeID);
    childrenCut.forEach((child, childOffset) => {
      newParagraphBlockBox.insertChild(child, childOffset);
    });
    this.clearCache();
    return newParagraphBlockBox;
  }

  join(paragraphBlockBox: ParagraphBlockBox) {
    if (paragraphBlockBox.getRenderNodeID() !== this.renderNodeID) {
      throw new Error('Cannot join block boxes with different render node IDs.');
    }
    let childOffset = this.children.length;
    paragraphBlockBox.getChildren().forEach(child => {
      this.insertChild(child, childOffset);
      childOffset++;
    });
    this.clearCache();
  }

  resolveViewportPositionToSelectableOffset(x: number, y: number) {
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
