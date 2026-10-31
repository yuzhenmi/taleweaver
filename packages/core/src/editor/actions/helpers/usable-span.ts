import type { EditorState } from "../../editor-state";
import type { Span } from "../../../state";
import { isCollapsed } from "../../../cursor/selection";
import { isCrossContextSelection } from "./is-cross-context-selection";

export function usableSpan(editor: EditorState, span: Span | undefined): Span | null {
  const target = span ?? editor.selection;
  if (isCollapsed(target) || isCrossContextSelection(editor.document, target)) return null;
  return target;
}
