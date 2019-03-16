import KeySignature from './KeySignature';
import getKeySignatureFromKeyboardEvent from './helpers/getKeySignatureFromKeyboardEvent';

export type KeySignatureSubscriber = () => void;

export default class InputManager {
  protected subscriptions: Map<string, KeySignatureSubscriber[]>;

  constructor() {
    this.subscriptions = new Map();
  }

  subscribeOnKeyboardInput(keySignature: KeySignature, subscriber: KeySignatureSubscriber) {
    const keySignatureCode = keySignature.getCode();
    if (!this.subscriptions.has(keySignatureCode)) {
      this.subscriptions.set(keySignatureCode, []);
    }
    const subscribers = this.subscriptions.get(keySignatureCode)!;
    subscribers.push(subscriber);
  }

  onKeyPress(event: KeyboardEvent) {
    const keySignature = getKeySignatureFromKeyboardEvent(event);
    if (!keySignature) {
      return;
    }
    const keySignatureCode = keySignature.getCode();
    if (!this.subscriptions.has(keySignatureCode)) {
      return;
    }
    const subscribers = this.subscriptions.get(keySignatureCode)!;
    subscribers.forEach(subscriber => subscriber());
  }
}
