import Editor from '../Editor';
import KeySignature from '../key/KeySignature';
import * as keys from '../key/keys';
import * as modifierKeys from '../key/modifierKeys';
import {
  moveCursorLeft,
  moveCursorRight,
  moveCursorHeadLeft,
  moveCursorHeadRight,
  moveCursorLeftByWord,
  moveCursorRightByWord,
  moveCursorHeadLeftByWord,
  moveCursorHeadRightByWord,
  moveCursorToLeftOfLine,
  moveCursorToRightOfLine,
  moveCursorHeadToLeftOfLine,
  moveCursorHeadToRightOfLine,
  moveCursorToLineAbove,
  moveCursorToLineBelow,
  moveCursorHeadToLineAbove,
  moveCursorHeadToLineBelow,
  moveCursorToRightOfDoc,
  moveCursorToLeftOfDoc,
  moveCursorHeadToRightOfDoc,
  moveCursorHeadToLeftOfDoc,
  selectAll,
  deleteBackward,
  deleteForward,
  split,
} from '../command/commands';

function bindKeys(editor: Editor) {
  const config = editor.getConfig();
  const dispatcher = editor.getDispatcher();
  config.bindKey(new KeySignature(keys.ArrowLeftKey), () => dispatcher.dispatchCommand(moveCursorLeft()));
  config.bindKey(new KeySignature(keys.ArrowRightKey), () => dispatcher.dispatchCommand(moveCursorRight()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadLeft()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadRight()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey]), () => dispatcher.dispatchCommand(moveCursorLeftByWord()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey]), () => dispatcher.dispatchCommand(moveCursorRightByWord()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadLeftByWord()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadRightByWord()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToLeftOfLine()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToRightOfLine()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLeftOfLine()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToRightOfLine()));
  config.bindKey(new KeySignature(keys.ArrowUpKey), () => dispatcher.dispatchCommand(moveCursorToLineAbove()));
  config.bindKey(new KeySignature(keys.ArrowDownKey), () => dispatcher.dispatchCommand(moveCursorToLineBelow()));
  config.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLineAbove()));
  config.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLineBelow()));
  config.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToLeftOfDoc()));
  config.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToRightOfDoc()));
  config.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLeftOfDoc()));
  config.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToRightOfDoc()));
  config.bindKey(new KeySignature(keys.AKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(selectAll()));
  config.bindKey(new KeySignature(keys.BackspaceKey), () => dispatcher.dispatchCommand(deleteBackward()));
  config.bindKey(new KeySignature(keys.DeleteKey), () => dispatcher.dispatchCommand(deleteForward()));
  config.bindKey(new KeySignature(keys.EnterKey), () => dispatcher.dispatchCommand(split()));
}

export default bindKeys;
