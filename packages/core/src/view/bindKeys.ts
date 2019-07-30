import {
    deleteBackward,
    deleteForward,
    moveCursorHeadLeft,
    moveCursorHeadLeftByWord,
    moveCursorHeadRight,
    moveCursorHeadRightByWord,
    moveCursorHeadToLeftOfDoc,
    moveCursorHeadToLeftOfLine,
    moveCursorHeadToLineAbove,
    moveCursorHeadToLineBelow,
    moveCursorHeadToRightOfDoc,
    moveCursorHeadToRightOfLine,
    moveCursorLeft,
    moveCursorLeftByWord,
    moveCursorRight,
    moveCursorRightByWord,
    moveCursorToLeftOfDoc,
    moveCursorToLeftOfLine,
    moveCursorToLineAbove,
    moveCursorToLineBelow,
    moveCursorToRightOfDoc,
    moveCursorToRightOfLine,
    selectAll,
    split,
} from '../command/commands';
import Editor from '../Editor';
import * as keys from '../key/keys';
import KeySignature from '../key/KeySignature';
import * as modifierKeys from '../key/modifierKeys';

function bindKeys(editor: Editor) {
    const keyBindingConfig = editor.getConfig().getKeyBindingConfig();
    const dispatcher = editor.getDispatcher();
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowLeftKey), () => dispatcher.dispatchCommand(moveCursorLeft()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowRightKey), () => dispatcher.dispatchCommand(moveCursorRight()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadLeft()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadRight()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey]), () => dispatcher.dispatchCommand(moveCursorLeftByWord()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey]), () => dispatcher.dispatchCommand(moveCursorRightByWord()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadLeftByWord()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.AltKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadRightByWord()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToLeftOfLine()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToRightOfLine()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowLeftKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLeftOfLine()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowRightKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToRightOfLine()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowUpKey), () => dispatcher.dispatchCommand(moveCursorToLineAbove()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowDownKey), () => dispatcher.dispatchCommand(moveCursorToLineBelow()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLineAbove()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLineBelow()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToLeftOfDoc()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(moveCursorToRightOfDoc()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowUpKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToLeftOfDoc()));
    keyBindingConfig.bindKey(new KeySignature(keys.ArrowDownKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchCommand(moveCursorHeadToRightOfDoc()));
    keyBindingConfig.bindKey(new KeySignature(keys.AKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchCommand(selectAll()));
    keyBindingConfig.bindKey(new KeySignature(keys.BackspaceKey), () => dispatcher.dispatchCommand(deleteBackward()));
    keyBindingConfig.bindKey(new KeySignature(keys.DeleteKey), () => dispatcher.dispatchCommand(deleteForward()));
    keyBindingConfig.bindKey(new KeySignature(keys.EnterKey), () => dispatcher.dispatchCommand(split()));
    keyBindingConfig.bindKey(new KeySignature(keys.ZKey, [modifierKeys.MetaKey]), () => dispatcher.dispatchUndo());
    keyBindingConfig.bindKey(new KeySignature(keys.ZKey, [modifierKeys.MetaKey, modifierKeys.ShiftKey]), () => dispatcher.dispatchRedo());
}

export default bindKeys;
