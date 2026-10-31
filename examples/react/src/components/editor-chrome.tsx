import type { EditorAction, Editor } from "@taleweaver/core";
import { DocMenuBar } from "./menu-bar";
import { Toolbar } from "./toolbar";

/**
 * The backend-agnostic editor chrome: the document menu-bar + the formatting
 * toolbar. Both dispatch plain `EditorAction`s and read `Editor`, so the
 * same chrome drives either backend (print canvas or digital DOM) — the tab-bar
 * just feeds it the active backend's `dispatch` / `editor`.
 */
export function EditorChrome({
  dispatch,
  editor,
  focus,
}: {
  dispatch: React.Dispatch<EditorAction>;
  editor: Editor;
  focus: () => void;
}) {
  return (
    <>
      <DocMenuBar dispatch={dispatch} editor={editor} focus={focus} />
      <Toolbar dispatch={dispatch} editor={editor} />
    </>
  );
}
