import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, spanStart, spanEnd } from "../../state";
import type { TextTransform } from "../../styles";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";

/**
 * Set the text-transform on the current selection. Used by the toolbar's
 * Format ▸ Text ▸ Capitalization control; can also be dispatched
 * programmatically.
 *
 * `value` is one of the CSS keywords (`"none" | "capitalize" | "uppercase" |
 * "lowercase"`). A non-`"none"` value is set as `{ textTransform: value }` on
 * every text item in the selection; the cascade's `textTransformInterpreter`
 * then maps it to `ComputedStyle.textTransform`, which the IFC applies to the
 * rendered glyphs.
 *
 * `"none"` REMOVES the attr (passes `{ textTransform: undefined }`, which
 * `mergeAttrs` interprets as a removal) rather than writing an explicit
 * `"none"`. `"none"` is the cascade's initial value, so a removed attr renders
 * identically; removing it (vs. persisting the default on every char) keeps the
 * attr bag minimal AND lets run-merge normalization re-coalesce the run with
 * neighbouring untransformed text (an explicit `{ textTransform: "none" }`
 * would compare unequal to a bare `{}` run and fragment it). This mirrors how
 * the color handler clears to its default.
 *
 * Mirrors set-text-color.ts: collapsed selection short-circuits to a no-op (no
 * transform can be applied to a single cursor position); state-equality
 * short-circuit; selection re-built from normalized start/end; dirtyIds
 * threaded through to the incremental render pipeline.
 */
export function handleSetTextTransform(
  editor: EditorState,
  value: TextTransform,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  // `"none"` is the initial value → remove the attr (undefined = removal in
  // mergeAttrs) so the run re-merges with untransformed neighbours; any other
  // keyword is written explicitly.
  const attrValue = value === "none" ? undefined : value;
  const result = applyAttrsOrSuggest(editor.state, selection, { textTransform: attrValue }, config);
  if (result.state === editor.state) return editor;

  // Selection invariant under attribute changes — preserve anchor/focus but
  // rebuild span ordering from normalized start/end so consumers see a
  // consistent shape.
  const start = spanStart(editor.state, selection);
  const end = spanEnd(editor.state, selection);
  const newSelection = createSpan(
    createPosition(start.blockId, start.offset),
    createPosition(end.blockId, end.offset),
  );

  editor.history.commit(result, {
    before: selection,
    after: newSelection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}
