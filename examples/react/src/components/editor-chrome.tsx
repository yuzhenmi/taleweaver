import type { EditorAction, EditorState } from "@taleweaver/core";
import { DocMenuBar } from "./menu-bar";
import { Toolbar } from "./toolbar";

/**
 * The backend-agnostic editor chrome: the document menu-bar + the formatting
 * toolbar. Both dispatch plain `EditorAction`s and read `EditorState`, so the
 * same chrome drives either backend (print canvas or digital DOM) — the tab-bar
 * just feeds it the active backend's `dispatch` / `editorState`.
 */
export function EditorChrome({
  dispatch,
  editorState,
  focus,
}: {
  dispatch: React.Dispatch<EditorAction>;
  editorState: EditorState;
  focus: () => void;
}) {
  return (
    <>
      <DocMenuBar dispatch={dispatch} editorState={editorState} focus={focus} />
      <Toolbar dispatch={dispatch} editorState={editorState} />
    </>
  );
}
