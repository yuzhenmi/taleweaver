import PageLayout from './PageLayout';

interface ViewportBoundingRect {
  pageOffset: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export default class DocLayout {
  protected pageLayouts: PageLayout[];

  constructor() {
    this.pageLayouts = [];
  }

  insertPageLayout(pageLayout: PageLayout) {
    this.pageLayouts.push(pageLayout);
  }

  getChildren(): PageLayout[] {
    return this.pageLayouts;
  }

  resolveViewportPositionToSelectableOffset(pageOffset: number, x: number, y: number): number {
    if (pageOffset >= this.pageLayouts.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    let selectableOffset = 0;
    for (let n = 0; n < pageOffset; n++) {
      selectableOffset += this.pageLayouts[n].getSelectableSize();
    }
    return selectableOffset + this.pageLayouts[pageOffset].resolveViewportPositionToSelectableOffset(x, y);
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    const viewportBoundingRects: ViewportBoundingRect[] = [];
    let selectableOffset = 0;
    for (let n = 0, nn = this.pageLayouts.length; n < nn; n++) {
      const pageLayout = this.pageLayouts[n];
      const minChildOffset = 0;
      const maxChildOffset = pageLayout.getSelectableSize();
      const childFrom = Math.min(Math.max(from - selectableOffset, minChildOffset), maxChildOffset);
      const childTo = Math.min(Math.max(to - selectableOffset, minChildOffset), maxChildOffset);
      if (childFrom !== childTo) {
        const childViewportBoundingRects = pageLayout.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects.push({
            pageOffset: n,
            left: childViewportBoundingRect.left,
            right: childViewportBoundingRect.right,
            top: childViewportBoundingRect.top,
            bottom: childViewportBoundingRect.bottom,
            width: childViewportBoundingRect.width,
            height: childViewportBoundingRect.height,
          });
        });
      }
      selectableOffset += pageLayout.getSelectableSize();
    }
    return viewportBoundingRects;
  }
}
