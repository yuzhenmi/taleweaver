import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { planReplaceMatches, applyReplaceAllPlan, createPosition, createSpan } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * REPLACE_ALL — replace EVERY match in `matches` with `replacement` in ONE undo
 * step. Plans the per-block batch (`planReplaceMatches`), applies it
 * in a single `applyOperation` (`applyReplaceAllPlan`), and collapses the cursor
 * to the start of the first affected block's first replacement (deterministic +
 * always valid).
 *
 * Empty `matches` → no-op (returns `editor` unchanged, identity preserved).
 */
export function handleReplaceAll(
  editor: EditorState,
  { matches, replacement }: ActionOf<"REPLACE_ALL">,
): Edit | null {
  if (matches.length === 0) return null;

  const plan = planReplaceMatches(editor.state, matches, replacement);
  const result = applyReplaceAllPlan(editor.state, plan);

  // No-op identity contract.
  if (result.state === editor.state) return null;

  // Cursor: collapse to the start of the FIRST affected block's first
  // replacement (the document-first block in `blockWrites`, which preserves
  // first-seen block order from the document-ordered `matches`). Replacements are
  // descending, so the block's first is its LAST; its `start` is the seam (where a
  // removed bookmark's start marker was).
  // `matches.length > 0` (guarded above) and a non-no-op result mean the plan
  // wrote to at least one block, so the first block-write is always present.
  const firstWrite = plan.blockWrites[0];
  if (firstWrite === undefined) {
    throw new Error(
      "handleReplaceAll: applyReplaceAllPlan mutated state but produced no block-writes (invariant violation)",
    );
  }
  const firstBlockId = firstWrite.blockId;
  const seam = firstWrite.replacements[firstWrite.replacements.length - 1]?.start ?? 0;
  const newCursor = createPosition(firstBlockId, seam);
  const newSelection = createSpan(newCursor, newCursor);

  return { change: result, selection: newSelection };
}
