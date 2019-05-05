import Editor from '../Editor';
import Config from '../Config';
import Dispatcher from '../dispatch/Dispatcher';
import KeySignature from '../input/KeySignature';
import * as keys from '../input/keys';
import * as modifierKeys from '../input/modifierKeys';
import {
  moveLeft,
  moveRight,
  moveHeadLeft,
  moveHeadRight,
  moveLeftByWord,
  moveRightByWord,
  moveHeadLeftByWord,
  moveHeadRightByWord,
  moveToLeftOfLine,
  moveToRightOfLine,
  moveHeadToLeftOfLine,
  moveHeadToRightOfLine,
  moveToLineAbove,
  moveToLineBelow,
  moveHeadToLineAbove,
  moveHeadToLineBelow,
  moveToRightOfDoc,
  moveToLeftOfDoc,
  moveHeadToRightOfDoc,
  moveHeadToLeftOfDoc,
  selectAll,
} from '../input/cursorCommands';
import {
  deleteBackward,
  deleteForward,
  split,
} from '../input/docCommands';

function bindCursorNavivagateKeys(config: Config, dispatcher: Dispatcher) {
  config.bindKey(new KeySignature(keys.ArrowLeftKey), () => dispatcher.dispatchCommand(moveLeft()));
  config.bindKey(new KeySignature(keys.ArrowRightKey), () => dispatcher.dispatchCommand(moveRight()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadLeft()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadRight()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey]), () => dispatcher.dispatchCommand(moveLeftByWord()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey]), () => dispatcher.dispatchCommand(moveRightByWord()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadLeftByWord()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadRightByWord()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveToLeftOfLine()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveToRightOfLine()));
  config.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadToLeftOfLine()));
  config.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadToRightOfLine()));
  config.bindKey(new KeySignature(keys.ArrowUpKey), () => dispatcher.dispatchCommand(moveToLineAbove()));
  config.bindKey(new KeySignature(keys.ArrowDownKey), () => dispatcher.dispatchCommand(moveToLineBelow()));
  config.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadToLineAbove()));
  config.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadToLineBelow()));
  config.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveToLeftOfDoc()));
  config.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveToRightOfDoc()));
  config.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadToLeftOfDoc()));
  config.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveHeadToRightOfDoc()));
  config.bindKey(new KeySignature(keys.AKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(selectAll()));
}

function bindDocEditKeys(config: Config, dispatcher: Dispatcher) {
  config.bindKey(new KeySignature(keys.BackspaceKey), () => dispatcher.dispatchCommand(deleteBackward()));
  config.bindKey(new KeySignature(keys.DeleteKey), () => dispatcher.dispatchCommand(deleteForward()));
  config.bindKey(new KeySignature(keys.EnterKey), () => dispatcher.dispatchCommand(split()));
}

function bindKeys(editor: Editor) {
  const config = editor.getConfig();
  const dispatcher = editor.getDispatcher();
  bindCursorNavivagateKeys(config, dispatcher);
  bindDocEditKeys(config, dispatcher);
}

export default bindKeys;
