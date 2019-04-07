import Editor from '../Editor';

export default class PageDOMObserver {
  protected editor: Editor;
  protected mutationObserver: MutationObserver;

  constructor(editor: Editor) {
    this.editor = editor;
    this.mutationObserver = new MutationObserver(this.handleMutations);
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
    // TODO
  }

  protected handleCharacterDataMutation(mutation: MutationRecord) {
    // TODO
  }
}
