import Extension from '../extension/Extension';
import Cursor from './Cursor';

export default class CursorExtension extends Extension {
  protected cursor: Cursor;

  constructor() {
    super();
    this.cursor = new Cursor(0, 0);
  }

  onReflowed() {
    const provider = this.getProvider();
    const viewportBoundingRectsByPage = provider.resolveSelectableOffsetRangeToViewportBoundingRects(0, 100);
    let firstPageOffset: number = -1;
    let firstViewportBoundingRectOffset: number = -1;
    let lastPageOffset: number = -1;
    let lastViewportBoundingRectOffset: number = -1;
    viewportBoundingRectsByPage.forEach((viewportBoundingRects, pageOffset) => {
      const pageDOMContentContainer = provider.getPageDOMContentContainer(pageOffset);
      viewportBoundingRects.forEach((viewportBoundingRect, viewportBoundingRectOffset) => {
        if (firstPageOffset < 0) {
          firstPageOffset = pageOffset;
          firstViewportBoundingRectOffset = viewportBoundingRectOffset;
        }
        lastPageOffset = pageOffset;
        lastViewportBoundingRectOffset = viewportBoundingRectOffset;
        const domSelection = document.createElement('div');
        domSelection.className = 'tw--cursor-selection'
        domSelection.style.position = 'absolute';
        domSelection.style.top = `${viewportBoundingRect.top}px`;
        domSelection.style.left = `${viewportBoundingRect.left}px`;
        domSelection.style.width = `${viewportBoundingRect.width}px`;
        domSelection.style.height = `${viewportBoundingRect.height}px`;
        pageDOMContentContainer.appendChild(domSelection);
      });
    });
    let headPageOffset: number;
    let headLeft: number;
    let headTop: number;
    let headHeight: number;
    if (this.cursor.getAnchor() < this.cursor.getHead()) {
      headPageOffset = firstPageOffset;
      const viewportBoundingRect = viewportBoundingRectsByPage[firstPageOffset][firstViewportBoundingRectOffset];
      headLeft = viewportBoundingRect.left;
      headTop = viewportBoundingRect.top;
      headHeight = viewportBoundingRect.height;
    } else {
      headPageOffset = lastPageOffset;
      const viewportBoundingRect = viewportBoundingRectsByPage[lastPageOffset][lastViewportBoundingRectOffset];
      headLeft = viewportBoundingRect.left + viewportBoundingRect.width;
      headTop = viewportBoundingRect.top;
      headHeight = viewportBoundingRect.height;
    }
    const domHead = document.createElement('div');
    domHead.className = 'tw--cursor-head'
    domHead.style.position = 'absolute';
    domHead.style.top = `${headTop}px`;
    domHead.style.left = `${headLeft}px`;
    domHead.style.height = `${headHeight}px`;
    provider.getPageDOMContentContainer(headPageOffset).appendChild(domHead);
  }
}
