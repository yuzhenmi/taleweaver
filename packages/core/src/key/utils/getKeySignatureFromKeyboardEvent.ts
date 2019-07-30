import Key from '../Key';
import * as keys from '../keys';
import KeySignature from '../KeySignature';
import ModifierKey from '../ModifierKey';
import { AltKey, CtrlKey, MetaKey, ShiftKey } from '../modifierKeys';

const KEY_STRING_TO_KEY_MAP: { [key: string]: Key } = {
    'a': keys.AKey,
    'b': keys.BKey,
    'c': keys.CKey,
    'd': keys.DKey,
    'e': keys.EKey,
    'f': keys.FKey,
    'g': keys.GKey,
    'h': keys.HKey,
    'i': keys.IKey,
    'j': keys.JKey,
    'k': keys.KKey,
    'l': keys.LKey,
    'm': keys.MKey,
    'n': keys.NKey,
    'o': keys.OKey,
    'p': keys.PKey,
    'q': keys.QKey,
    'r': keys.RKey,
    's': keys.SKey,
    't': keys.TKey,
    'u': keys.UKey,
    'v': keys.VKey,
    'w': keys.WKey,
    'x': keys.XKey,
    'y': keys.YKey,
    'z': keys.ZKey,
    'A': keys.AKey,
    'B': keys.BKey,
    'C': keys.CKey,
    'D': keys.DKey,
    'E': keys.EKey,
    'F': keys.FKey,
    'G': keys.GKey,
    'H': keys.HKey,
    'I': keys.IKey,
    'J': keys.JKey,
    'K': keys.KKey,
    'L': keys.LKey,
    'M': keys.MKey,
    'N': keys.NKey,
    'O': keys.OKey,
    'P': keys.PKey,
    'Q': keys.QKey,
    'R': keys.RKey,
    'S': keys.SKey,
    'T': keys.TKey,
    'U': keys.UKey,
    'V': keys.VKey,
    'W': keys.WKey,
    'X': keys.XKey,
    'Y': keys.YKey,
    'Z': keys.ZKey,
    'Num1': keys.Num1Key,
    'Num2': keys.Num2Key,
    'Num3': keys.Num3Key,
    'Num4': keys.Num4Key,
    'Num5': keys.Num5Key,
    'Num6': keys.Num6Key,
    'Num7': keys.Num7Key,
    'Num8': keys.Num8Key,
    'Num9': keys.Num9Key,
    'Num0': keys.Num0Key,
    'Dash': keys.DashKey,
    'Equal': keys.EqualKey,
    'Space': keys.SpaceKey,
    'ArrowLeft': keys.ArrowLeftKey,
    'ArrowRight': keys.ArrowRightKey,
    'ArrowUp': keys.ArrowUpKey,
    'ArrowDown': keys.ArrowDownKey,
    'Backspace': keys.BackspaceKey,
    'Delete': keys.DeleteKey,
    'Enter': keys.EnterKey,
};

function getKeyFromKeyString(keyString: string): Key | null {
    if (!(keyString in KEY_STRING_TO_KEY_MAP)) {
        return null;
    }
    return KEY_STRING_TO_KEY_MAP[keyString];
}

export default function getKeySignatureFromKeyboardEvent(event: KeyboardEvent): KeySignature | null {
    const modifierKeys: ModifierKey[] = [];
    if (event.altKey) {
        modifierKeys.push(AltKey);
    }
    if (event.ctrlKey) {
        modifierKeys.push(CtrlKey);
    }
    if (event.metaKey) {
        modifierKeys.push(MetaKey);
    }
    if (event.shiftKey) {
        modifierKeys.push(ShiftKey);
    }
    const key = getKeyFromKeyString(event.key);
    if (!key) {
        return null;
    }
    return new KeySignature(key, modifierKeys);
}
