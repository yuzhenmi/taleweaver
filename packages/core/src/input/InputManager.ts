import KeySignature from './KeySignature';
import getKeySignatureFromKeyboardEvent from './helpers/getKeySignatureFromKeyboardEvent';

export type CharInputSubscriber = (char: string) => void;
export type KeyPressSubscriber = () => void;

export default class InputManager {
  protected charInputSubscribers: CharInputSubscriber[];
  protected keyPressSubscriptions: Map<string, KeyPressSubscriber[]>;

  constructor() {
    this.charInputSubscribers = [];
    this.keyPressSubscriptions = new Map();
  }

  subscribeOnCharInput(subscriber: CharInputSubscriber) {
    this.charInputSubscribers.push(subscriber);
  }

  subscribeOnKeyPress(keySignature: KeySignature, subscriber: KeyPressSubscriber) {
    const keySignatureCode = keySignature.getCode();
    if (!this.keyPressSubscriptions.has(keySignatureCode)) {
      this.keyPressSubscriptions.set(keySignatureCode, []);
    }
    const subscribers = this.keyPressSubscriptions.get(keySignatureCode)!;
    subscribers.push(subscriber);
  }

  onKeyPress(event: KeyboardEvent) {
    if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key !== 'Shift') {
      this.charInputSubscribers.forEach(subscriber => subscriber(event.key));
    }
    const keySignature = getKeySignatureFromKeyboardEvent(event);
    if (!keySignature) {
      return;
    }
    const keySignatureCode = keySignature.getCode();
    if (!this.keyPressSubscriptions.has(keySignatureCode)) {
      return;
    }
    const subscribers = this.keyPressSubscriptions.get(keySignatureCode)!;
    subscribers.forEach(subscriber => subscriber());
    if (subscribers.length > 0) {
      event.preventDefault();
    }
  }
}
