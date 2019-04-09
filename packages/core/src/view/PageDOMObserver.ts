import Editor from '../Editor';
import PageViewNode from './PageViewNode';
import { replace } from '../input/commands';

export default class PageDOMObserver {
  protected editor: Editor;
  protected pageViewNode: PageViewNode;
  protected mutationObserver: MutationObserver;

  constructor(editor: Editor, pageViewNode: PageViewNode) {
    this.editor = editor;
    this.pageViewNode = pageViewNode;
    this.mutationObserver = new MutationObserver(this.handleMutations);
    this.connect();
  }

  getPageID(): string {
    return this.pageViewNode.getID();
  }

  connect() {
    const pageDOMContentContainer = this.pageViewNode.getDOMContentContainer();
    this.mutationObserver.observe(pageDOMContentContainer, {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  disconnect() {
    this.mutationObserver.disconnect();
  }

  protected handleMutations = (mutations: MutationRecord[]) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        this.handleChildListMutation(mutation);
      } else if (mutation.type === 'characterData') {
        this.handleCharacterDataMutation(mutation);
      }
    });
  }

  protected handleChildListMutation(mutation: MutationRecord) {
    this.disconnect();
    // TODO: Undo mutation
    // TODO: Build transformation
    // TODO: Apply transformation
    this.connect();
  }

  protected handleCharacterDataMutation(mutation: MutationRecord) {
    this.disconnect();
    const oldContent = mutation.oldValue;
    const newContent = mutation.target.textContent;
    const mutatedNode = mutation.target;
    mutatedNode.textContent = mutation.oldValue;
    const offset = this.editor.getPresenter().resolveSelectionPosition(mutatedNode, 0);
    if (offset >= 0) {
      const from = offset;
      const to = offset + (oldContent ? oldContent.length : 0);
      this.editor.getDispatcher().dispatchCommand(replace(from, to, newContent || ''));
    }
    this.connect();
  }
}
