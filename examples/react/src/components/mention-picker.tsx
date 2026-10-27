import { useEffect, useState } from "react";
import {
  replaceRangeWithMarkedText,
  type ActiveTrigger,
  type Command,
  type EditorAction,
  type EditorExtensions,
  type EditorState,
  type Position,
} from "@taleweaver/core";
import { MENTION, mentionAction } from "./mentions";

/**
 * Generic host-extension demo (shared by the print and digital tabs):
 * - a `@` trigger opening a picker of example names filtered by the typed query
 *   (ArrowUp/Down/Enter/Tab through the host keymap while it is open, click to pick,
 *   Escape — the default — closes it); picking replaces "@query" with a mention mark
 *   in ONE undo step;
 * - `Mod-Shift-m`: mention the selection, or open the picker at the caret;
 * - an input rule: "--" → "—" (one Undo brings the "--" back).
 */
const PEOPLE: readonly string[] = [
  "Anna Berg",
  "Ben Ito",
  "Carla Diaz",
  "Dev Patel",
  "Eli Novak",
  "Farah Khan",
  "Gus Moreau",
  "Hana Sato",
];

/** The picker's live state, shared between the React popup and the keymap commands. */
export interface PickerBridge {
  matches: readonly string[];
  index: number;
  /** Re-render the popup after a keymap command moved the highlight. */
  notify: () => void;
}

export function createPickerBridge(): PickerBridge {
  return { matches: [], index: 0, notify: () => {} };
}

export function filterPeople(query: string): readonly string[] {
  const q = query.toLowerCase();
  return PEOPLE.filter((p) => p.toLowerCase().split(" ").some((part) => part.startsWith(q)));
}

/** The transaction replacing the trigger text with a mention of `name`. */
export function pickAction(trigger: ActiveTrigger, name: string): EditorAction {
  const ref = `person:${name.toLowerCase().replace(/\s+/g, "-")}`;
  return replaceRangeWithMarkedText(trigger, name, { key: MENTION, value: { ref, label: name } }, " ");
}

/** The demo's host extensions, driving `bridge` (one per editor surface). */
export function createDemoExtensions(bridge: PickerBridge): EditorExtensions {
  const open = (editor: EditorState): ActiveTrigger | null =>
    editor.activeTrigger?.id === MENTION && bridge.matches.length > 0 ? editor.activeTrigger : null;
  const move = (delta: number): Command => (editor, dispatch) => {
    if (open(editor) === null) return false;
    if (dispatch !== undefined) {
      bridge.index = (bridge.index + delta + bridge.matches.length) % bridge.matches.length;
      bridge.notify();
    }
    return true;
  };
  const pick: Command = (editor, dispatch) => {
    const trigger = open(editor);
    const name = bridge.matches[bridge.index];
    if (trigger === null || name === undefined) return false;
    dispatch?.(pickAction(trigger, name));
    return true;
  };
  const mention: Command = (editor, dispatch) => {
    const action = mentionAction(editor) ?? { type: "INSERT_TEXT", text: "@", userInput: true };
    dispatch?.(action);
    return true;
  };
  return {
    commands: { mention, pickMention: pick },
    keymap: {
      "Mod-Shift-m": "mention",
      ArrowDown: move(1),
      ArrowUp: move(-1),
      Enter: "pickMention",
      Tab: "pickMention",
    },
    inputRules: [{ pattern: /--$/, replace: "—" }],
    triggers: [{ id: MENTION, text: "@" }],
  };
}

/**
 * The popup under the caret while a `@` trigger is open. `caretRect` locates a
 * position on screen (each backend has its own way).
 */
export function MentionPicker({
  editorState,
  dispatch,
  bridge,
  caretRect,
}: {
  editorState: EditorState;
  dispatch: (action: EditorAction) => void;
  bridge: PickerBridge;
  caretRect: (position: Position) => { left: number; top: number; height: number } | null;
}) {
  const trigger = editorState.activeTrigger?.id === MENTION ? editorState.activeTrigger : undefined;
  const [, rerender] = useState(0);
  const query = trigger?.query;
  useEffect(() => {
    bridge.matches = query === undefined ? [] : filterPeople(query);
    bridge.index = 0;
    bridge.notify = () => rerender((n) => n + 1);
    rerender((n) => n + 1);
  }, [bridge, query]);
  if (trigger === undefined || bridge.matches.length === 0) return null;
  const rect = caretRect(trigger.from);
  if (rect === null) return null;
  return (
    <ul
      className="fixed z-50 min-w-40 rounded-md border bg-white py-1 text-sm shadow-md"
      style={{ left: rect.left, top: rect.top + rect.height + 4 }}
      role="listbox"
    >
      {bridge.matches.map((name, i) => (
        <li
          key={name}
          role="option"
          aria-selected={i === bridge.index}
          className={`cursor-pointer px-3 py-1 ${i === bridge.index ? "bg-[#e8f0fe] text-[#174ea6]" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the editor's focus and selection
            dispatch(pickAction(trigger, name));
          }}
        >
          @{name}
        </li>
      ))}
    </ul>
  );
}

/** The demo hint row, shared by both tabs. */
export function ExtensionsHint() {
  return (
    <div className="border-b px-4 py-1 text-xs text-gray-500">
      Host extensions demo: type <kbd>@</kbd> for the mention picker (↑/↓/Enter, Esc), <kbd>Mod-Shift-M</kbd> mentions
      the selection, <kbd>--</kbd> becomes an em dash (Undo restores it).
    </div>
  );
}
