import Editor from '../Editor';
import StateTransformation from '../state/Transformation';
import { Insert, Delete } from '../state/operations';
import CursorTransformation from '../cursor/Transformation';
import PageViewNode from './PageViewNode';
import { MoveTo } from '../cursor/operations';

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

export default class PageDOMObserver {
  protected editor: Editor;
  protected pageViewNode: PageViewNode;
  protected mutationObserver: MutationObserver;
  protected disconnected: boolean;

  constructor(editor: Editor, pageViewNode: PageViewNode) {
    this.editor = editor;
    this.pageViewNode = pageViewNode;
    this.mutationObserver = new MutationObserver(this.handleMutations);
    this.disconnected = false;
    this.resume();
  }

  getPageID(): string {
    return this.pageViewNode.getID();
  }

  disconnect() {
    this.pause();
    this.disconnected = true;
  }

  protected resume() {
    if (this.disconnected) {
      return;
    }
    // Clear queue
    this.mutationObserver.takeRecords();
    const pageDOMContentContainer = this.pageViewNode.getDOMContentContainer();
    this.mutationObserver.observe(pageDOMContentContainer, {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  protected pause() {
    this.mutationObserver.disconnect();
  }

  protected handleMutations = (mutations: MutationRecord[]) => {
    this.pause();
    const transformation = new StateTransformation();
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        this.handleChildListMutation(mutation, transformation);
      } else if (mutation.type === 'characterData') {
        this.handleCharacterDataMutation(mutation, transformation);
      }
    });
    const cursorTransformation = new CursorTransformation();
    let insertDelta = 0;
    transformation.getOperations().forEach(operation => {
      if (operation.getDelta() > 0) {
        insertDelta += operation.getDelta();
      }
    });
    // FIXME: The cursor transformation handling is totally wrong
    const cursor = this.editor.getCursor();
    if (insertDelta === 0) {
      cursorTransformation.addOperation(new MoveTo(Math.min(cursor.getAnchor(), cursor.getHead())));
    } else {
      cursorTransformation.addOperation(new MoveTo(Math.min(cursor.getAnchor(), cursor.getHead()) + insertDelta));
    }
    this.editor.getDispatcher().dispatchCommand((editor: Editor) => [transformation, cursorTransformation]);
    this.resume();
  }

  protected handleChildListMutation(mutation: MutationRecord, transformation: StateTransformation) {
    // TODO: Undo mutation
    mutation.addedNodes.forEach(addedNode => {
      if (addedNode.parentNode) {
        addedNode.parentNode.removeChild(addedNode);
      }
    });
    mutation.removedNodes.forEach(removedNode => {
      if (mutation instanceof HTMLElement && mutation.nextSibling) {
        mutation.target.insertBefore(mutation.nextSibling, removedNode);
      } else {
        mutation.target.appendChild(removedNode);
      }
    });
    // TODO: Add operations to transformation
  }

  protected handleCharacterDataMutation(mutation: MutationRecord, transformation: StateTransformation) {
    const oldContent = mutation.oldValue || '';
    const newContent = mutation.target.textContent || '';
    const mutatedNode = mutation.target;
    mutatedNode.textContent = mutation.oldValue;
    const offset = this.editor.getPresenter().resolveSelectionPosition(mutatedNode, 0);
    if (offset < 0) {
      return;
    }
    const [oldA, oldB, newA, newB] = getStringDiff(oldContent, newContent);
    const editor = this.editor;
    const deleteFrom = editor.convertSelectableOffsetToModelOffset(offset + oldA);
    const deleteTo = editor.convertSelectableOffsetToModelOffset(offset + oldB);
    const insertAt = deleteFrom;
    const tokensToInsert = newContent.slice(newA, newB).split('');
    transformation.addOperation(new Delete(deleteFrom, deleteTo));
    transformation.addOperation(new Insert(insertAt, tokensToInsert));
  }
}
