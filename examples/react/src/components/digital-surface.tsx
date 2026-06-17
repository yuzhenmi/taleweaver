import { useEffect } from "react";
import type { State } from "@taleweaver/core";
import { useDigitalEditor } from "../use-digital-editor";
import { EditorChrome } from "./editor-chrome";
import { SelectionBubble } from "./selection-bubble";
import { BlockHoverHandles } from "./block-hover-handles";

/**
 * The DIGITAL editing surface: the `@taleweaver/digital` contenteditable backend
 * — the browser flows the styled tree to the container width; NO print geometry,
 * NO pagination. Shares the same chrome (the toolbar dispatches the same
 * `EditorAction`s). Exposes its live `State` via `registerGetState` for the
 * tab-bar hand-off. Find/replace (print-geometry-specific) is omitted in v1.
 *
 * Notion-style canvas: there is NO "page" (page chrome is a print-only concept).
 * The editor is a blank canvas whose content is capped to a comfortable reading
 * width and centered — not a US-Letter sheet floating on a gray backdrop. (The
 * persistent toolbar is a later step toward inline selection tools.)
 */
export function DigitalSurface({
  seed,
  registerGetState,
}: {
  seed: State | null;
  registerGetState: (getState: () => State) => void;
}) {
  const editor = useDigitalEditor(seed ?? undefined);

  useEffect(() => {
    registerGetState(editor.getState);
  }, [registerGetState, editor.getState]);

  return (
    <>
      <EditorChrome dispatch={editor.dispatch} editorState={editor.editorState} focus={editor.focus} />
      {/* Blank canvas — no page sheet/shadow/backdrop. Content is centered and capped to a
          comfortable reading column (Notion-style), so the browser flows to that width. */}
      <div className="relative flex-1 overflow-y-auto bg-white">
        <div
          ref={editor.containerRef}
          className="mx-auto min-h-[60vh] w-full max-w-[720px] px-6 py-16 outline-none"
        />
      </div>
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
