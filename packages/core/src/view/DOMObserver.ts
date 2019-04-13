import Editor from '../Editor';
import DocViewNode from './DocViewNode';
import getKeySignatureFromKeyboardEvent from '../input/helpers/getKeySignatureFromKeyboardEvent';
import * as cursorCommands from '../input/cursorCommands';
import PageViewNode from './PageViewNode';
import PageDOMObserver from './PageDOMObserver';

export default class DOMObserver {
  protected editor: Editor;
  protected docViewNode?: DocViewNode;
  protected isFocused: boolean;
  protected isMouseDown: boolean;
  protected pageDOMObservers: PageDOMObserver[];

  constructor(editor: Editor) {
    this.editor = editor;
    this.isFocused = false;
    this.isMouseDown = false;
    this.pageDOMObservers = [];
  }

  connectDoc(docViewNode: DocViewNode) {
    this.docViewNode = docViewNode;
    const docViewDOMContainer = docViewNode.getDOMContainer();
    docViewDOMContainer.addEventListener('focus', this.onFocus);
    docViewDOMContainer.addEventListener('blur', this.onBlur);
    docViewDOMContainer.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  connectPage(pageViewNode: PageViewNode) {
    const pageDOMObserver = new PageDOMObserver(this.editor, pageViewNode);
    this.pageDOMObservers.push(pageDOMObserver);
  }

  disconnectPage(pageViewNode: PageViewNode) {
    const offset = this.pageDOMObservers.findIndex(o => o.getPageID() === pageViewNode.getID());
    if (offset < 0) {
      throw new Error(`No DOM observer found for page ${pageViewNode.getID()}.`);
    }
    this.pageDOMObservers[offset].disconnect();
    this.pageDOMObservers.splice(offset, 1);
  }

  protected onFocus = (event: FocusEvent) => {
    this.isFocused = true;
  }

  protected onBlur = (event: FocusEvent) => {
    this.isFocused = false;
  }

  protected onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    // Ignore if target is not in page
    let isInPage = false;
    let currentElement: HTMLElement | null = event.target;
    while (currentElement) {
      if (currentElement.getAttribute('data-tw-role') === 'page') {
        isInPage = true;
        break;
      }
      currentElement = currentElement.parentElement;
    }
    if (!isInPage) {
      return;
    }
    this.isMouseDown = true;
    const offset = this.resolveScreenPosition(event.clientX, event.clientY);
    if (offset < 0) {
      return;
    }
    this.editor.getDispatcher().dispatchCommand(cursorCommands.moveTo(offset));
  }

  protected onMouseMove = (event: MouseEvent) => {
    if (!this.isMouseDown) {
      return;
    }
    const offset = this.resolveScreenPosition(event.clientX, event.clientY);
    if (offset < 0) {
      return;
    }
    this.editor.getDispatcher().dispatchCommand(cursorCommands.moveHeadTo(offset));
  }

  protected onMouseUp = (event: MouseEvent) => {
    this.isMouseDown = false;
  }

  protected onKeyDown = (event: KeyboardEvent) => {
    const keySignature = getKeySignatureFromKeyboardEvent(event);
    if (!keySignature) {
      return;
    }
    const handled = this.editor.getDispatcher().dispatchKeyPress(keySignature);
    if (handled) {
      event.preventDefault();
    }
  }

  protected resolveScreenPosition(x: number, y: number): number {
    if (!this.docViewNode) {
      throw new Error('No doc view is being observed.');
    }
    const pageViews = this.docViewNode.getChildren();
    const pageFlowBoxes = this.editor.getLayoutEngine().getDocBox().getChildren();
    let cumulatedOffset = 0;
    for (let n = 0, nn = pageViews.length; n < nn; n++) {
      const pageView = pageViews[n];
      const pageFlowBox = pageFlowBoxes[n];
      const pageDOMContainer = pageView.getDOMContainer();
      const pageBoundingClientRect = pageDOMContainer.getBoundingClientRect();
      if (
        pageBoundingClientRect.left <= x &&
        pageBoundingClientRect.right >= x &&
        pageBoundingClientRect.top <= y &&
        pageBoundingClientRect.bottom >= y
      ) {
        const relativeX = x - pageBoundingClientRect.left;
        const relativeY = y - pageBoundingClientRect.top;
        return cumulatedOffset + pageFlowBox.resolveViewportPositionToSelectableOffset(relativeX, relativeY);
      }
      cumulatedOffset += pageFlowBox.getSelectableSize();
    }
    return -1;
  }
}
