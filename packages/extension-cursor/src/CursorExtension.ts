import {
  KeySignature,
  keys,
  modifierKeys,
  CursorCommand,
  Extension,
} from '@taleweaver/core';
import {
  moveLeft,
  moveRight,
  moveHeadLeft,
  moveHeadRight,
  moveLeftByWord,
  moveRightByWord,
  moveHeadLeftByWord,
  moveHeadRightByWord,
  moveToLeftOfLine,
  moveToRightOfLine,
  moveHeadToLeftOfLine,
  moveHeadToRightOfLine,
  moveToLineAbove,
  moveToLineBelow,
  moveHeadToLineAbove,
  moveHeadToLineBelow,
  moveToRightOfDoc,
  moveToLeftOfDoc,
  moveHeadToRightOfDoc,
  moveHeadToLeftOfDoc,
  selectAll,
} from './commands';

export default class CursorExtension extends Extension {
  protected leftAnchor: number | null;
  protected blinkState: boolean;
  protected blinkInterval: number | null;
  protected domSelections: HTMLDivElement[];
  protected domHead: HTMLDivElement;

  constructor() {
    super();
    this.leftAnchor = null;
    this.blinkState = false;
    this.blinkInterval = null;
    this.domSelections = [];
    this.domHead = document.createElement('div');;
    this.domHead.className = 'tw--cursor-head'
    this.domHead.style.position = 'absolute';
  }

  getLeftAnchor(): number | null {
    return this.leftAnchor;
  }

  onRegistered() {
    this.subscribeOnInputs();
    this.getEditor().getCursor().subscribeOnChanged(this.onCursorChanged);
  }

  onMounted() {
    this.updateView();
  }

  protected subscribeOnInputs() {
    const inputManager = this.getEditor().getInputManager();
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowLeftKey), () => this.dispatchCommand(moveLeft(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowRightKey), () => this.dispatchCommand(moveRight(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowLeftKey, [modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadLeft(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowRightKey, [modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadRight(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey]), () => this.dispatchCommand(moveLeftByWord(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey]), () => this.dispatchCommand(moveRightByWord(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadLeftByWord(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadRightByWord(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey]), () => this.dispatchCommand(moveToLeftOfLine(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey]), () => this.dispatchCommand(moveToRightOfLine(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadToLeftOfLine(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadToRightOfLine(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowUpKey), () => this.dispatchCommand(moveToLineAbove(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowDownKey), () => this.dispatchCommand(moveToLineBelow(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowUpKey, [modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadToLineAbove(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowDownKey, [modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadToLineBelow(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey]), () => this.dispatchCommand(moveToLeftOfDoc(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey]), () => this.dispatchCommand(moveToRightOfDoc(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadToLeftOfDoc(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => this.dispatchCommand(moveHeadToRightOfDoc(this)));
    inputManager.subscribeOnKeyboardInput(new KeySignature(keys.AKey, [modifierKeys.MetaKey]), () => this.dispatchCommand(selectAll(this)));
  }

  protected dispatchCommand(command: CursorCommand) {
    const editor = this.getEditor();
    const transformation = command(editor);
    editor.getCursor().applyTransformation(transformation);
    this.leftAnchor = transformation.getLeftAnchor();
  }

  protected onCursorChanged = () => {
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

    const editor = this.getEditor();
    const cursor = editor.getCursor();
    const layoutEngine = editor.getLayoutEngine();
    const presenter = editor.getPresenter();
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    const viewportBoundingRectsByPage = layoutEngine.getDocLayout().resolveSelectableOffsetRangeToViewportBoundingRects(Math.min(anchor, head), Math.max(anchor, head));
    let firstPageOffset: number = -1;
    let firstViewportBoundingRectOffset: number = -1;
    let lastPageOffset: number = -1;
    let lastViewportBoundingRectOffset: number = -1;
    viewportBoundingRectsByPage.forEach((viewportBoundingRects, pageOffset) => {
      const pageDOMContentContainer = presenter.getPageDOMContentContainer(pageOffset);
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
    this.domHead.style.top = `${headTop}px`;
    this.domHead.style.left = `${headLeft}px`;
    this.domHead.style.height = `${headHeight}px`;
    const pageDOMContentContainer = presenter.getPageDOMContentContainer(headPageOffset);
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
