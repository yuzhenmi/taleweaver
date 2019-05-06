import Editor from '../Editor';
import {
  CursorBlurredEvent,
  CursorFocusedEvent,
  CursorStateUpdatedEvent,
  ViewStateUpdatedEvent,
} from '../dispatch/events';

const CURSOR_HUE = 213;

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
    this.domSelections = [];
    editor.getDispatcher().on(CursorStateUpdatedEvent, event => this.updateView());
    editor.getDispatcher().on(ViewStateUpdatedEvent, event => this.updateView());
    editor.getDispatcher().on(CursorFocusedEvent, event => this.updateView());
    editor.getDispatcher().on(CursorBlurredEvent, event => this.updateView());
    setTimeout(() => this.updateView());
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

  protected updateView() {
    const cursor = this.editor.getCursor();
    const isFocused = this.editor.getViewManager().getIsFocused();
    const docBox = this.editor.getLayoutManager().getDocBox();
    const pageViewNodes = this.editor.getViewManager().getPageViewNodes();

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
        domSelection.style.userSelect = 'none';
        domSelection.style.pointerEvents = 'none';
        if (isFocused) {
          domSelection.style.background = `hsla(${CURSOR_HUE}, 100%, 50%, 0.2)`;
        } else {
          domSelection.style.background = 'hsla(0, 0%, 0%, 0.08)';
        }
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
    if (isFocused) {
      this.domCaret.style.background = `hsla(${CURSOR_HUE}, 100%, 50%, 1)`;
    } else {
      this.domCaret.style.background = 'hsla(0, 0%, 0%, 0.5)';
    }
    const pageDOMContainer = pageViewNodes[headPageOffset].getDOMContainer();
    if (this.domCaret.parentElement && this.domCaret.parentElement !== pageDOMContainer) {
      this.domCaret.parentElement.removeChild(this.domCaret);
    }
    if (!this.domCaret.parentElement) {
      pageDOMContainer.appendChild(this.domCaret);
    }

    // Scroll cursor head into view, if focused
    if (isFocused) {
      this.domCaret.scrollIntoView({ block: 'nearest' });
    }

    // Reset blinking
    this.stopBlinking();
    if (isFocused) {
      this.startBlinking();
    }
  }
}
