import { useEffect, useState } from "react";
import type { State } from "@taleweaver/core";
import { useDigitalEditor } from "../use-digital-editor";
import { EditorChrome } from "./editor-chrome";
import { SelectionBubble } from "./selection-bubble";
import { BlockHoverHandles } from "./block-hover-handles";
import { FindBar, useFindShortcut } from "./find-bar";
import { AsyncCheckBar, useAsyncCheck } from "./async-check";
import { createDemoExtensions, createPickerBridge, ExtensionsHint, MentionPicker } from "./mention-picker";
import { useWritingAids, WritingAidPopover, WritingAidsToggle, type AidPointerEvent } from "./writing-aids";

/**
 * The DIGITAL editing surface: the `@taleweaver/digital` contenteditable backend
 * — the browser flows the styled tree to the container width; NO print geometry,
 * NO pagination. Shares the same chrome (the toolbar dispatches the same
 * `EditorAction`s). Exposes its live `State` via `registerGetState` for the
 * tab-bar hand-off. Find/replace and the writing-aids demo are shared with the print tab.
 *
 * Notion-style canvas: there is NO "page" (page chrome is a print-only concept).
 * The editor is a blank canvas whose content is capped to a comfortable reading
 * width and centered — not a US-Letter sheet floating on a gray backdrop. (The
 * persistent toolbar is a later step toward inline selection tools.)
 */
/** The DOM caret's rect (the browser lays out digital text; the caret sits at the query end). */
function domCaretRect() {
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { left: r.left, top: r.top, height: r.height };
}

export function DigitalSurface({
  seed,
  registerGetState,
}: {
  seed: State | null;
  registerGetState: (getState: () => State) => void;
}) {
  const [pointer, setPointer] = useState<AidPointerEvent | null>(null);
  // Host extensions demo (mention picker, keymap, input rule) — same as the print tab.
  const [bridge] = useState(createPickerBridge);
  const [extensions] = useState(() => createDemoExtensions(bridge));
  const editor = useDigitalEditor(seed ?? undefined, setPointer, extensions);
  const [aids, setAids] = useState(true);
  const [findMode, setFindMode] = useState<null | "find" | "replace">(null);
  useFindShortcut(setFindMode);
  // Async-check demo (anchors) — same as the print tab.
  const check = useAsyncCheck(editor.editorState, editor.createAnchor);
  useWritingAids(aids, editor.editorState, editor.setDecorations, check.decorations);

  useEffect(() => {
    registerGetState(editor.getState);
  }, [registerGetState, editor.getState]);

  return (
    <>
      <EditorChrome dispatch={editor.dispatch} editorState={editor.editorState} focus={editor.focus} />
      {/* Blank canvas — no page sheet/shadow/backdrop. Content is centered and capped to a
          comfortable reading column (Notion-style), so the browser flows to that width. */}
      <WritingAidsToggle checked={aids} onChange={setAids} />
      <ExtensionsHint />
      <AsyncCheckBar check={check} />
      <div className="relative flex-1 overflow-y-auto bg-white">
        {findMode && (
          <FindBar
            handle={editor.findHandle}
            mode={findMode}
            editorState={editor.editorState}
            onClose={() => {
              setFindMode(null);
              editor.focus();
            }}
          />
        )}
        <div
          ref={editor.containerRef}
          className="mx-auto min-h-[60vh] w-full max-w-[720px] px-6 py-16 outline-none"
        />
      </div>
      <WritingAidPopover event={pointer} />
      <MentionPicker editorState={editor.editorState} dispatch={editor.dispatch} bridge={bridge} caretRect={domCaretRect} />
      <SelectionBubble dispatch={editor.dispatch} editorState={editor.editorState} containerRef={editor.containerRef} />
      <BlockHoverHandles
        dispatch={editor.dispatch}
        editorState={editor.editorState}
        containerRef={editor.containerRef}
        focus={editor.focus}
      />
    </>
  );
}
