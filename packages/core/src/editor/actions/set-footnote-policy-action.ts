import type { EditorState, EditorConfig } from "../editor-state";
import { mergeBlockAttrs } from "../../state";
import type { CounterFormat, FootnoteNumberingPolicy } from "../../footnotes";
import { isValidFootnoteReset, isValidFootnoteFormat } from "../../footnotes";
import { rebuildTrees } from "./helpers";

/**
 * `SET_FOOTNOTE_POLICY` handler — changes the DOCUMENT-WIDE footnote numbering
 * policy by writing the `footnoteNumberingReset` / `footnoteNumberingFormat`
 * raw attrs onto the document ROOT block (`state.rootId`). The policy is read
 * back by `documentFootnotePolicy` (`footnotes/policy.ts`), threaded by render,
 * and DISPLAYED — `restart-per-section` restarts numbering at each section,
 * `restart-per-page` runs FN-6.4's layout-dependent second pass. This is the
 * editor surface that makes those policies user-selectable.
 *
 * `reset` and `format` are set INDEPENDENTLY — only the provided field(s) change;
 * an omitted field leaves the existing policy attr untouched. Each value is
 * validated against its closed literal set (`isValidFootnoteReset` /
 * `isValidFootnoteFormat`, the same sets render validates against); an INVALID
 * value is IGNORED (never written as an unrecognized attr).
 *
 * The root block lands in `dirtyIds`, so:
 *  - FN-8's `dirtyIds.has(state.rootId)` guard recomputes the numbering map
 *    (the policy lives on the root, which carries no anchor itself), and
 *  - for `restart-per-page`, FN-6.4's `rebuildTrees` second pass runs once
 *    layout supplies the per-page anchor assignment.
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 *  - No valid field supplied (both omitted / both invalid) → nothing to write.
 *  - The merge is a no-op (`mergeBlockAttrs` returns the same state reference):
 *    the policy already equals the requested value — the T7 identity guard
 *    mirrors `handleToggleSectionLandscape` / `handleSetTextAlign`.
 *
 * Selection is UNCHANGED: a policy change does not move the caret.
 */
export function handleSetFootnotePolicy(
  editor: EditorState,
  action: {
    reset?: FootnoteNumberingPolicy["reset"];
    format?: CounterFormat;
  },
  config: EditorConfig,
): EditorState {
  // Build the incoming attr patch from ONLY the valid, provided fields. An
  // invalid value is silently dropped; an omitted field is never written, so
  // the other field's existing attr is preserved.
  const incoming: Record<string, FootnoteNumberingPolicy["reset"] | CounterFormat> = {};
  if (isValidFootnoteReset(action.reset)) {
    incoming["footnoteNumberingReset"] = action.reset;
  }
  if (isValidFootnoteFormat(action.format)) {
    incoming["footnoteNumberingFormat"] = action.format;
  }

  // Nothing valid to write → no-op (return the input editor unchanged).
  if (Object.keys(incoming).length === 0) return editor;

  const result = mergeBlockAttrs(
    editor.state,
    editor.state.rootId,
    incoming,
    config.attrRegistry,
  );

  // T7 identity contract: a no-op merge (policy already at the requested value)
  // returns the same state reference → return the input editor unchanged.
  if (result.state === editor.state) return editor;

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}
