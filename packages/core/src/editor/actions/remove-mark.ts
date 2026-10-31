import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { iterateSpan, blockMarkRanges, markEqualityOf, deepValueEqual, createPosition, createSpan } from "../../state";
import type { Span, ReadonlyAttrs, Document } from "../../state";
import { type AttrRegistry } from "../../cascade/attr-registry";
import type { ActionOf } from "../editor-action";
import { applyDeltas } from "./helpers/apply-deltas";
import { usableSpan } from "./helpers/usable-span";
import { isNonExclusive } from "./helpers/is-non-exclusive";

/**
 * The removal deltas for REMOVE_MARK: one `[sub-span, { attrKey: undefined }]` per
 * stored range of the mark inside `span` (restricted to `value` when given), so
 * nothing outside an actual mark range is touched (no empty tracked suggestion).
 */
function removalDeltas(
  document: Document,
  span: Span,
  key: string,
  value: unknown,
  nonExclusive: boolean,
  registry: AttrRegistry,
): Array<readonly [Span, ReadonlyAttrs]> {
  const match = nonExclusive ? (k: string) => k.startsWith(`${key}#`) : (k: string) => k === key;
  // The mark type's own equality (custom `equals`, else deep) — as run merging uses.
  const equality = markEqualityOf(registry);
  const equals = registry.get(key)?.equals ?? deepValueEqual;
  const out: Array<readonly [Span, ReadonlyAttrs]> = [];
  for (const seg of iterateSpan(document, span)) {
    const content = seg.block.inlineContent;
    if (content === null) continue;
    for (const r of blockMarkRanges(content, match, equality)) {
      const start = Math.max(r.start, seg.rangeStart);
      const end = Math.min(r.end, seg.rangeEnd);
      if (start >= end || (value !== undefined && !equals(r.value, value))) continue;
      out.push([createSpan(createPosition(seg.block.id, start), createPosition(seg.block.id, end)), { [r.attrKey]: undefined }]);
    }
  }
  return out;
}

/**
 * REMOVE_MARK: remove mark `key` from the span (default: the selection) — only
 * where its value equals `value` (the type's `equals`, else deep) when given,
 * every value otherwise.
 */
export function handleRemoveMark(
  editor: EditorState,
  { key, value, span }: ActionOf<"REMOVE_MARK">,
): Edit | null {
  const target = usableSpan(editor, span);
  if (target === null) return null;
  return applyDeltas(
    editor,
    removalDeltas(editor.document, target, key, value, isNonExclusive(editor, key), editor.config.attrRegistry),
  );
}
