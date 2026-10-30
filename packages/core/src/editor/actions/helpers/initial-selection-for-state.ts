import { createPosition, createSpan } from "../../../state";
import type { State, Selection } from "../../../state";
import { findFirstContentBlock } from "./find-first-content-block";

/**
 * Derive the initial collapsed `Selection` for a freshly-built or freshly-loaded
 * document: a caret at offset 0 of the first content-bearing leaf block
 * (`findFirstContentBlock`). Falls back to the root block id when the document
 * has no content leaf (a degenerate container-only doc) so the caller always
 * gets a well-formed Selection. Shared by `createInitialEditorState` (the empty
 * document) and `loadDocument` (an arbitrary deserialized document) so both
 * derive the caret the same robust way (the empty-document factory seeds a
 * paragraph, so this matches the prior `firstChildId` result there, but it also
 * handles a loaded doc whose first child is a container, e.g. a section).
 */
export function initialSelectionForState(state: State): Selection {
  const firstContent = findFirstContentBlock(state) ?? state.rootId;
  const caret = createPosition(firstContent, 0);
  return createSpan(caret, caret);
}
