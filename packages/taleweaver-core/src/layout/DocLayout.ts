import PageLayout from './PageLayout';

export interface ViewportBoundingRect {
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

  resolveViewportCoordinateToSelectableOffset(pageOffset: number, x: number, y: number): number {
    if (pageOffset >= this.pageLayouts.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    let selectableOffset = 0;
    for (let n = 0; n < pageOffset; n++) {
      selectableOffset += this.pageLayouts[n].getSelectableSize();
    }
    return selectableOffset + this.pageLayouts[pageOffset].resolveViewportCoordinateToSelectableOffset(x, y);
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    // TODO
    return [];
  }
}
