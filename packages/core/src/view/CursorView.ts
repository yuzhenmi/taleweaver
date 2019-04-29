import Editor from '../Editor';
import Cursor from '../cursor/Cursor';
import DocBox from '../layout/DocBox';
import PageViewNode from './PageViewNode';

export default class CursorView {
  protected editor: Editor;
  protected leftAnchor: number | null;
  protected blinkState: boolean;
  protected blinkInterval: number | null;
  protected domCaret: HTMLDivElement;
  protected domSelections: HTMLDivElement[];

  constructor(editor: Editor) {
    this.editor = editor;
    this.leftAnchor = null;
    this.blinkState = false;
    this.blinkInterval = null;
    this.domCaret = document.createElement('div');
    this.domCaret.className = 'tw--cursor-caret'
    this.domCaret.style.position = 'absolute';
    this.domCaret.style.userSelect = 'none';
    this.domCaret.style.pointerEvents = 'none';
    this.domCaret.style.width = '2px';
    this.domCaret.style.marginLeft = '-1px';
    this.domCaret.style.background = 'hsla(213, 100%, 50%, 1)';
    this.domSelections = [];
  }

  onUpdated(cursor: Cursor, docBox: DocBox, pageViewNodes: PageViewNode[]) {
    this.updateView(cursor, docBox, pageViewNodes);
  }

  getLeftAnchor(): number | null {
    return this.leftAnchor;
  }

  protected startBlinking() {
    if (this.blinkInterval !== null) {
      return;
    }
    this.blinkInterval = setInterval(() => {
      if (this.blinkState) {
        this.domCaret.style.visibility = 'hidden';
      } else {
        this.domCaret.style.visibility = 'visible';
      }
      this.blinkState = !this.blinkState;
    }, 500);
  }

  protected stopBlinking() {
    if (this.blinkInterval === null) {
      return;
    }
    this.blinkState = true;
    this.domCaret.style.visibility = 'visible';
    clearInterval(this.blinkInterval);
    this.blinkInterval = null;
  }

  protected updateView(cursor: Cursor, docBox: DocBox, pageViewNodes: PageViewNode[]) {
    // Clear dom selections
    while (this.domSelections.length > 0) {
      const domSelection = this.domSelections[0];
      if (domSelection.parentElement) {
        domSelection.parentElement.removeChild(domSelection);
      }
      this.domSelections.splice(0, 1);
    }
    // Render cursor caret and selections
    const anchor = Math.min(Math.max(cursor.getAnchor(), 0), docBox.getSelectableSize() - 1);
    const head = Math.min(Math.max(cursor.getHead(), 0), docBox.getSelectableSize() - 1);
    const viewportBoundingRectsByPage = docBox.resolveSelectableOffsetRangeToViewportBoundingRects(Math.min(anchor, head), Math.max(anchor, head));
    let firstPageOffset: number = -1;
    let firstViewportBoundingRectOffset: number = -1;
    let lastPageOffset: number = -1;
    let lastViewportBoundingRectOffset: number = -1;
    viewportBoundingRectsByPage.forEach((viewportBoundingRects, pageOffset) => {
      const pageDOMContainer = pageViewNodes[pageOffset].getDOMContainer();
      viewportBoundingRects.forEach((viewportBoundingRect, viewportBoundingRectOffset) => {
        if (firstPageOffset < 0) {
          firstPageOffset = pageOffset;
          firstViewportBoundingRectOffset = viewportBoundingRectOffset;
        }
        lastPageOffset = pageOffset;
        lastViewportBoundingRectOffset = viewportBoundingRectOffset;
        if (viewportBoundingRect.width === 0) {
          return;
        }
        const domSelection = document.createElement('div');
        domSelection.className = 'tw--cursor-selection'
        domSelection.style.position = 'absolute';
        domSelection.style.top = `${viewportBoundingRect.top}px`;
        domSelection.style.left = `${viewportBoundingRect.left}px`;
        domSelection.style.width = `${viewportBoundingRect.width}px`;
        domSelection.style.height = `${viewportBoundingRect.height}px`;
        domSelection.style.background = 'hsla(213, 100%, 50%, 0.2)';
        domSelection.style.userSelect = 'none';
        domSelection.style.pointerEvents = 'none';
        pageDOMContainer.appendChild(domSelection);
        this.domSelections.push(domSelection);
      });
    });
    let headPageOffset: number;
    let headLeft: number;
    let headTop: number;
    let headHeight: number;
    if (head < anchor) {
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
    this.domCaret.style.top = `${headTop}px`;
    this.domCaret.style.left = `${headLeft}px`;
    this.domCaret.style.height = `${headHeight}px`;
    const pageDOMContainer = pageViewNodes[headPageOffset].getDOMContainer();
    if (this.domCaret.parentElement && this.domCaret.parentElement !== pageDOMContainer) {
      this.domCaret.parentElement.removeChild(this.domCaret);
    }
    if (!this.domCaret.parentElement) {
      pageDOMContainer.appendChild(this.domCaret);
    }

    // Scroll cursor head into view
    this.domCaret.scrollIntoView({ block: 'nearest' });

    // Reset blinking
    this.stopBlinking();
    this.startBlinking();
  }
}
