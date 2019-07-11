import ModelStateUpdatedEvent from '../dispatch/events/ModelStateUpdatedEvent';
import StateUpdatedEvent from '../dispatch/events/StateUpdatedEvent';
import Editor from '../Editor';
import DocModelNode from './DocModelNode';

export default class ModelEngine {
  protected editor: Editor;
  protected doc: DocModelNode;

  constructor(editor: Editor) {
    this.editor = editor;
    this.doc = new DocModelNode(editor);
    editor.getDispatcher().on(StateUpdatedEvent, this.handleStateUpdatedEvent);
    this.sync();
  }

  protected handleStateUpdatedEvent = (event: StateUpdatedEvent) => {
    // TODO: Get range of tokens that need to be reparsed
    // TODO: Parse tokens to get new branch of model tree
    // TODO: Update old branch of model tree with new branch
    this.editor.getDispatcher().dispatch(new ModelStateUpdatedEvent());
  }
}
