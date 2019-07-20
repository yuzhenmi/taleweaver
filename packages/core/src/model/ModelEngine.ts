import ModelUpdatedEvent from '../dispatch/events/ModelUpdatedEvent';
import StateUpdatedEvent from '../dispatch/events/StateUpdatedEvent';
import Editor from '../Editor';
import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import DocModelNode from './DocModelNode';
import TokenParser from './StateParser';

export default class ModelEngine {
  protected editor: Editor;
  protected doc: DocModelNode;

  constructor(editor: Editor) {
    this.editor = editor;
    this.doc = new DocModelNode(editor);
    editor.getDispatcher().on(StateUpdatedEvent, this.handleStateUpdatedEvent);
  }

  getDoc() {
    return this.doc;
  }

  protected handleStateUpdatedEvent = (event: StateUpdatedEvent) => {
    const node = this.doc.resolvePosition(event.getBeforeFrom()).parent!.node;
    const tokens = this.editor.getStateService().getTokens();
    let from = event.getAfterFrom();
    while (!(tokens[from] instanceof OpenTagToken)) {
      from--;
    }
    let to = event.getAfterTo();
    while (!(tokens[to] instanceof CloseTagToken)) {
      to++;
    }
    const parser = new TokenParser(this.editor, tokens);
    const updatedNode = parser.getRootNode();
    node.onUpdated(updatedNode);
    this.editor.getDispatcher().dispatch(new ModelUpdatedEvent(node));
  }
}
