import Extension from '../extension/Extension';
import Cursor from './Cursor';
import KeySignature from '../input/KeySignature';
import { ArrowLeftKey, ArrowRightKey } from '../input/keys';
import Command from './Command';
import { moveLeft, moveRight } from './commands';
import Transformation from './Transformation';
import { MoveTo, MoveHeadTo } from './operations';

export default class CursorExtension extends Extension {
  protected cursor: Cursor;
  protected blinkState: boolean;
  protected blinkInterval: number | null;
  protected domSelections: HTMLDivElement[];
  protected domHead: HTMLDivElement;

  constructor() {
    super();
    this.cursor = new Cursor(0, 2000);
    this.blinkState = false;
    this.blinkInterval = null;
    this.domSelections = [];
    this.domHead = document.createElement('div');;
    this.domHead.className = 'tw--cursor-head'
    this.domHead.style.position = 'absolute';
  }

  getCursor(): Cursor {
    return this.cursor;
  }

  onRegistered() {
    this.subscribeOnInputs();
  }

  onReflowed() {
    this.updateView();
  }

  protected subscribeOnInputs() {
    const provider = this.getProvider();
    provider.subscribeOnKeyboardInput(new KeySignature(ArrowLeftKey), () => this.dispatchCommand(moveLeft()));
    provider.subscribeOnKeyboardInput(new KeySignature(ArrowRightKey), () => this.dispatchCommand(moveRight()));
  }

  protected dispatchCommand(command: Command) {
    const transformation = command(this);
    this.applyTransformation(transformation);
  }

  protected applyTransformation(transformation: Transformation) {
    const operations = transformation.getOperations();
    operations.forEach(operation => {
      if (operation instanceof MoveTo) {
        const offset = operation.getOffset();
        this.cursor.setAnchor(offset);
        this.cursor.setHead(offset);
      } else if (operation instanceof MoveHeadTo) {
        const offset = operation.getOffset();
        this.cursor.setHead(offset);
      } else {
        throw new Error('Unrecognized cursor transformation operation.');
      }
    });
    this.updateView();
  }

  protected startBlinking() {
    if (this.blinkInterval !== null) {
      return;
    }
    this.blinkInterval = setInterval(() => {
      if (this.blinkState) {
        this.domHead.style.visibility = 'hidden';
      } else {
        this.domHead.style.visibility = 'visible';
      }
      this.blinkState = !this.blinkState;
    }, 500);
  }

  protected stopBlinking() {
    if (this.blinkInterval === null) {
      return;
    }
    this.blinkState = true;
    this.domHead.style.visibility = 'visible';
    clearInterval(this.blinkInterval);
    this.blinkInterval = null;
  }

  protected updateView() {
    // Clear dom selections
    while (this.domSelections.length > 0) {
      const domSelection = this.domSelections[0];
      if (domSelection.parentElement) {
        domSelection.parentElement.removeChild(domSelection);
      }
      this.domSelections.splice(0, 1);
    }

    const provider = this.getProvider();
    const anchor = this.cursor.getAnchor();
    const head = this.cursor.getHead();
    const viewportBoundingRectsByPage = provider.resolveSelectableOffsetRangeToViewportBoundingRects(anchor, head);
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
        pageDOMContentContainer.appendChild(domSelection);
        this.domSelections.push(domSelection);
      });
    });
    let headPageOffset: number;
    let headLeft: number;
    let headTop: number;
    let headHeight: number;
    if (this.cursor.getHead() < this.cursor.getAnchor()) {
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
    this.domHead.style.top = `${headTop}px`;
    this.domHead.style.left = `${headLeft}px`;
    this.domHead.style.height = `${headHeight}px`;
    const pageDOMContentContainer = provider.getPageDOMContentContainer(headPageOffset);
    if (this.domHead.parentElement && this.domHead.parentElement !== pageDOMContentContainer) {
      this.domHead.parentElement.removeChild(this.domHead);
    }
    if (!this.domHead.parentElement) {
      pageDOMContentContainer.appendChild(this.domHead);
    }

    // Reset blinking
    this.stopBlinking();
    this.startBlinking();
  }
}
