import Key from './Key';
import ModifierKey from './ModifierKey';

export default class KeySignature {
    protected key: Key;
    protected modifierKeys: ModifierKey[];

    constructor(key: Key, modifierKeys: ModifierKey[] = []) {
        this.key = key;
        this.modifierKeys = modifierKeys;
    }

    getCode(): string {
        const modifierKeyCodes = this.modifierKeys.map(modifierKey => modifierKey.getCode()).sort();
        const keyCode = this.key.getCode();
        return [...modifierKeyCodes, keyCode].join('-');
    }
}
