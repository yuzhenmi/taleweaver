import ModifierKey from '../ModifierKey';
import KeySignature from '../KeySignature';
import Key from '../Key';
import { AltKey, CtrlKey, MetaKey, ShiftKey } from '../modifierKeys';
import {
  AKey,
  BKey,
  CKey,
  DKey,
  EKey,
  FKey,
  GKey,
  HKey,
  IKey,
  JKey,
  KKey,
  LKey,
  MKey,
  NKey,
  OKey,
  PKey,
  QKey,
  RKey,
  SKey,
  TKey,
  UKey,
  VKey,
  WKey,
  XKey,
  YKey,
  ZKey,
  Num1Key,
  Num2Key,
  Num3Key,
  Num4Key,
  Num5Key,
  Num6Key,
  Num7Key,
  Num8Key,
  Num9Key,
  Num0Key,
  DashKey,
  EqualKey,
  SpaceKey,
  ArrowLeftKey,
  ArrowRightKey,
  ArrowUpKey,
  ArrowDownKey,
  BackspaceKey,
  DeleteKey,
} from '../keys';

const KEY_STRING_TO_KEY_MAP: { [key: string]: Key } = {
  'a': AKey,
  'b': BKey,
  'c': CKey,
  'd': DKey,
  'e': EKey,
  'f': FKey,
  'g': GKey,
  'h': HKey,
  'i': IKey,
  'j': JKey,
  'k': KKey,
  'l': LKey,
  'm': MKey,
  'n': NKey,
  'o': OKey,
  'p': PKey,
  'q': QKey,
  'r': RKey,
  's': SKey,
  't': TKey,
  'u': UKey,
  'v': VKey,
  'w': WKey,
  'x': XKey,
  'y': YKey,
  'z': ZKey,
  'A': AKey,
  'B': BKey,
  'C': CKey,
  'D': DKey,
  'E': EKey,
  'F': FKey,
  'G': GKey,
  'H': HKey,
  'I': IKey,
  'J': JKey,
  'K': KKey,
  'L': LKey,
  'M': MKey,
  'N': NKey,
  'O': OKey,
  'P': PKey,
  'Q': QKey,
  'R': RKey,
  'S': SKey,
  'T': TKey,
  'U': UKey,
  'V': VKey,
  'W': WKey,
  'X': XKey,
  'Y': YKey,
  'Z': ZKey,
  'Num1': Num1Key,
  'Num2': Num2Key,
  'Num3': Num3Key,
  'Num4': Num4Key,
  'Num5': Num5Key,
  'Num6': Num6Key,
  'Num7': Num7Key,
  'Num8': Num8Key,
  'Num9': Num9Key,
  'Num0': Num0Key,
  'Dash': DashKey,
  'Equal': EqualKey,
  'Space': SpaceKey,
  'ArrowLeft': ArrowLeftKey,
  'ArrowRight': ArrowRightKey,
  'ArrowUp': ArrowUpKey,
  'ArrowDown': ArrowDownKey,
  'Backspace': BackspaceKey,
  'Delete': DeleteKey,
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
