import Command from '../command/Command';
import Editor from '../Editor';
import KeySignature from '../key/KeySignature';
import Event from './Event';

interface EventClass {
  getType(): string;
}

type Subscriber<E extends Event> = (event: E) => void;

class Dispatcher {
  protected editor: Editor;
  protected subscribers: Map<string, Subscriber<any>[]>;

  constructor(editor: Editor) {
    this.editor = editor;
    this.subscribers = new Map();
  }

  dispatch(event: Event) {
    const eventType = event.getType();
    if (!this.subscribers.has(eventType)) {
      return;
    }
    const subscribers = this.subscribers.get(eventType)!;
    subscribers.forEach(subscriber => subscriber(event));
  }

  on<E extends Event>(eventClass: EventClass, subscriber: Subscriber<E>) {
    const eventType = eventClass.getType();
    let subscribers: Subscriber<E>[];
    if (this.subscribers.has(eventType)) {
      subscribers = this.subscribers.get(eventType)!;
    } else {
      subscribers = [];
      this.subscribers.set(eventType, subscribers);
    }
    subscribers.push(subscriber);
  }

  dispatchCommand(command: Command) {
    const transformation = command(this.editor);
    this.editor.getTransformer().applyTransformation(transformation);
  }

  dispatchUndo() {
    this.editor.getTransformer().undo();
  }

  dispatchRedo() {
    this.editor.getTransformer().redo();
  }

  dispatchKeyPress(keySignature: KeySignature): boolean {
    const keyBindingConfig = this.editor.getConfig().getKeyBindingConfig();
    const keyBindings = keyBindingConfig.getKeyBindings();
    const keySignatureCode = keySignature.getCode();
    if (!keyBindings.has(keySignatureCode)) {
      return false;
    }
    const handlers = keyBindings.get(keySignatureCode)!;
    if (handlers.length === 0) {
      return false;
    }
    handlers.forEach(handler => handler());
    return true;
  }
}

export default Dispatcher;
