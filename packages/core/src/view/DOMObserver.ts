import Editor from '../Editor';
import StateTransformation from '../state/Transformation';
import { Insert, Delete } from '../state/operations';
import CursorTransformation from '../cursor/Transformation';
import { MoveTo, MoveHeadTo } from '../cursor/operations';
import getKeySignatureFromKeyboardEvent from '../input/helpers/getKeySignatureFromKeyboardEvent';
import * as cursorCommands from '../input/cursorCommands';
import DocViewNode from './DocViewNode';
import PageViewNode from './PageViewNode';

function getStringDiff(oldStr: string, newStr: string): [number, number, number, number] {
  let oldA = 0;
  let oldB = oldStr.length;
  let newA = 0;
  let newB = newStr.length;
  while (oldStr[oldA] === newStr[newA] && oldA < oldB && newA < newB) {
    oldA++;
    newA++;
  }
  while (oldStr[oldB - 1] === newStr[newB - 1] && oldB > oldA && newB > newA) {
    oldB--;
    newB--;
  }
  return [oldA, oldB, newA, newB];
}

export default class DOMObserver {
  protected editor: Editor;
  protected docViewNode?: DocViewNode;
  protected isFocused: boolean;
  protected isMouseDown: boolean;
  protected mutationObserver: MutationObserver;
  protected pageViewNodes: PageViewNode[];

  constructor(editor: Editor) {
    this.editor = editor;
    this.isFocused = false;
    this.isMouseDown = false;
    this.mutationObserver = new MutationObserver(this.handleMutations);
    this.pageViewNodes = [];
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
    if (this.pageViewNodes.indexOf(pageViewNode) >= 0) {
      return;
    }
    this.pauseMutationObserver();
    this.pageViewNodes.push(pageViewNode);
    this.resumeMutationObserver();
  }

  disconnectPage(pageViewNode: PageViewNode) {
    const offset = this.pageViewNodes.indexOf(pageViewNode);
    if (offset < 0) {
      return;
    }
    this.pauseMutationObserver();
    this.pageViewNodes.splice(offset, 1);
    this.resumeMutationObserver();
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
    // Bypass browser selection
    event.preventDefault();
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

  protected resumeMutationObserver() {
    this.pageViewNodes.forEach(pageViewNode => {
      const pageDOMContentContainer = pageViewNode.getDOMContentContainer();
      this.mutationObserver.observe(pageDOMContentContainer, {
        characterData: true,
        characterDataOldValue: true,
        childList: true,
        subtree: true,
      });
    });
  }

  protected pauseMutationObserver() {
    this.mutationObserver.disconnect();
  }

  protected handleMutations = (mutations: MutationRecord[]) => {
    this.pauseMutationObserver();
    this.syncCursorWithDOM();
    const transformation = new StateTransformation();
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        this.handleChildListMutation(mutation, transformation);
      } else if (mutation.type === 'characterData') {
        this.handleCharacterDataMutation(mutation, transformation);
      }
    });
    this.editor.getState().applyTransformation(transformation);
    this.resumeMutationObserver();
  }

  protected handleChildListMutation(mutation: MutationRecord, transformation: StateTransformation) {
    mutation.addedNodes.forEach(addedNode => {
      if (addedNode.parentNode) {
        addedNode.parentNode.removeChild(addedNode);
      }
      const offset = this.editor.getPresenter().resolveDOMNodePosition(addedNode, 0);
      if (offset < 0) {
        return;
      }
      const insertAt = this.editor.convertSelectableOffsetToModelOffset(offset);
      transformation.addOperation(new Insert(insertAt, (addedNode.textContent || '').split('')));
    });
    mutation.removedNodes.forEach(removedNode => {
      if (mutation instanceof HTMLElement && mutation.nextSibling) {
        mutation.target.insertBefore(mutation.nextSibling, removedNode);
      } else {
        mutation.target.appendChild(removedNode);
      }
      const offset = this.editor.getPresenter().resolveDOMNodePosition(removedNode, 0);
      if (offset < 0) {
        return;
      }
      const deleteFrom = this.editor.convertSelectableOffsetToModelOffset(offset);
      const deleteTo = this.editor.convertSelectableOffsetToModelOffset(offset + (removedNode.textContent || '').length);
      transformation.addOperation(new Delete(deleteFrom, deleteTo));
    });
  }

  protected handleCharacterDataMutation(mutation: MutationRecord, transformation: StateTransformation) {
    const oldContent = mutation.oldValue || '';
    const newContent = mutation.target.textContent || '';
    const mutatedNode = mutation.target;
    mutatedNode.textContent = mutation.oldValue;
    const offset = this.editor.getPresenter().resolveDOMNodePosition(mutatedNode, 0);
    if (offset < 0) {
      return;
    }
    const [oldA, oldB, newA, newB] = getStringDiff(oldContent, newContent);
    const editor = this.editor;
    const deleteFrom = editor.convertSelectableOffsetToModelOffset(offset + oldA);
    const deleteTo = editor.convertSelectableOffsetToModelOffset(offset + oldB);
    const insertAt = deleteFrom;
    const tokensToInsert = newContent.slice(newA, newB).split('');
    if (deleteFrom < deleteTo) {
      transformation.addOperation(new Delete(deleteFrom, deleteTo));
    }
    if (tokensToInsert.length > 0) {
      transformation.addOperation(new Insert(insertAt, tokensToInsert));
    }
  }

  protected syncCursorWithDOM() {
    const selection = window.getSelection();
    const presenter = this.editor.getPresenter();
    const anchor = presenter.resolveDOMNodePosition(selection.anchorNode, selection.anchorOffset);
    const head = presenter.resolveDOMNodePosition(selection.focusNode, selection.focusOffset);
    const transformation = new CursorTransformation();
    transformation.addOperation(new MoveTo(anchor));
    transformation.addOperation(new MoveHeadTo(head));
    this.editor.getCursor().applyTransformation(transformation);
  }
}
