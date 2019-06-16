import KeySignature from '../key/KeySignature';

type KeyBindingHandler = () => void;

class KeyBindingConfig {
  protected keyBindings: Map<string, KeyBindingHandler[]> = new Map();

  bindKey(keySignature: KeySignature, subscriber: KeyBindingHandler) {
    const keySignatureCode = keySignature.getCode();
    if (!this.keyBindings.has(keySignatureCode)) {
      this.keyBindings.set(keySignatureCode, []);
    }
    const subscribers = this.keyBindings.get(keySignatureCode)!;
    subscribers.push(subscriber);
  }

  getKeyBindings() {
    return this.keyBindings;
  }
}

export default KeyBindingConfig;
