import Editor from '../Editor';
import Event from './Event';
import Command from '../command/Command';
import KeySignature from '../key/KeySignature';

interface EventClass {
  getType(): string;
}

type Subscriber = (event: Event) => void;

class Dispatcher {
  protected editor: Editor;
  protected subscribers: Map<string, Subscriber[]>;

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

  on(eventClass: EventClass, subscriber: Subscriber) {
    const eventType = eventClass.getType();
    let subscribers: Subscriber[];
    if (this.subscribers.has(eventType)) {
      subscribers = this.subscribers.get(eventType)!;
    } else {
      subscribers = [];
      this.subscribers.set(eventType, subscribers);
    }
    subscribers.push(subscriber);
  }

  dispatchCommand(command: Command) {
    const tokenState = this.editor.getTokenManager().getTokenState();
    const cursor = this.editor.getCursor();
    const transformation = command(this.editor);
    tokenState.applyTransformation(transformation);
    let cursorAnchor = transformation.getCursorAnchor();
    if (cursorAnchor === null)  {
      cursorAnchor = cursor.getAnchor();
    }
    let cursorHead = transformation.getCursorHead();
    if (cursorHead === null)  {
      cursorHead = cursor.getHead();
    }
    cursor.set(cursorAnchor, cursorHead, transformation.getCursorLockLeft());
  }

  dispatchKeyPress(keySignature: KeySignature): boolean {
    const keyBindings = this.editor.getConfig().getKeyBindings();
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
