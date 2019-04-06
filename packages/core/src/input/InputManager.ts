import KeySignature from './KeySignature';
import getKeySignatureFromKeyboardEvent from './helpers/getKeySignatureFromKeyboardEvent';

export type OnCursorUpdatedSubscriber = (anchor: number, head: number) => void;
export type OnCursorHeadUpdatedSubscriber = (head: number) => void;
export type CharInputSubscriber = (char: string) => void;
export type KeyPressSubscriber = () => void;

export default class InputManager {
  protected onCursorUpdatedSubscribers: OnCursorUpdatedSubscriber[];
  protected onCursorHeadUpdatedSubscribers: OnCursorHeadUpdatedSubscriber[];
  protected charInputSubscribers: CharInputSubscriber[];
  protected keyPressSubscriptions: Map<string, KeyPressSubscriber[]>;

  constructor() {
    this.onCursorUpdatedSubscribers = [];
    this.onCursorHeadUpdatedSubscribers = [];
    this.charInputSubscribers = [];
    this.keyPressSubscriptions = new Map();
  }

  subscribeOnCursorUpdated(subscriber: OnCursorUpdatedSubscriber) {
    this.onCursorUpdatedSubscribers.push(subscriber);
  }

  subscribeOnCursorHeadUpdated(subscriber: OnCursorHeadUpdatedSubscriber) {
    this.onCursorHeadUpdatedSubscribers.push(subscriber);
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
    if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
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

  onCursorUpdated(anchor: number, head: number) {
    this.onCursorUpdatedSubscribers.forEach(subscriber => subscriber(anchor, head));
  }

  onCursorHeadUpdated(head: number) {
    this.onCursorHeadUpdatedSubscribers.forEach(subscriber => subscriber(head));
  }
}
