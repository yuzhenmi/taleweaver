import type { EditorState } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import { iterateSpan, blockMarkRanges, markEqualityOf, deepValueEqual, createPosition, createSpan } from "../../state";
import type { Span, BlockId, ReadonlyAttrs, State } from "../../state";
import { markInstanceKey, type AttrRegistry } from "../../cascade/attr-registry";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection } from "./selection-guards";

/** Apply each `[span, attrs]` delta in turn (one undo step), then commit + rebuild. */
function applyDeltas(
  editor: EditorState,
  deltas: ReadonlyArray<readonly [Span, ReadonlyAttrs]>,
  config: EditorConfig,
): EditorState {
  let state = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const [span, attrs] of deltas) {
    const r = applyAttrsOrSuggest(state, span, attrs, config);
    state = r.state;
    for (const id of r.dirtyIds) dirtyIds.add(id);
  }
  if (state === editor.state) return editor;
  // An attr-only edit shifts no offsets: the selection is kept as-is (direction too).
  const { selection } = editor;
  editor.history.commit({ state, dirtyIds }, { before: selection, after: selection });
  return rebuildTrees({ ...editor, state, selection }, editor, config, dirtyIds);
}

function usableSpan(editor: EditorState, span: Span | undefined): Span | null {
  const target = span ?? editor.selection;
  if (isCollapsed(target) || isCrossContextSelection(editor.state, target)) return null;
  return target;
}

/** True when `key` is a registered NON-exclusive mark type (instances overlap). */
function isNonExclusive(key: string, config: EditorConfig): boolean {
  return config.attrRegistry.get(key)?.mark?.exclusive === false;
}

/**
 * SET_MARK: put mark `key` = `value` on the span (default: the selection). An
 * exclusive mark writes `key` (replacing any other value there); a non-exclusive
 * mark adds an instance under its own key, so it overlaps existing instances.
 * `replace` (non-exclusive only) names an existing instance to swap out: its
 * removal and the new instance form ONE delta — one undo step, one formatting
 * suggestion. Formatting attrs on the runs are untouched (merge semantics).
 */
export function handleSetMark(
  editor: EditorState,
  key: string,
  value: unknown,
  replace: unknown,
  span: Span | undefined,
  config: EditorConfig,
): EditorState {
  const target = usableSpan(editor, span);
  if (target === null || value === undefined) return editor;
  if (!isNonExclusive(key, config)) return applyDeltas(editor, [[target, { [key]: value }]], config);
  const delta: Record<string, unknown> = {};
  if (replace !== undefined) delta[markInstanceKey(key, replace)] = undefined;
  delta[markInstanceKey(key, value)] = value; // after the removal: replace === value keeps it
  return applyDeltas(editor, [[target, delta]], config);
}

/**
 * The removal deltas for REMOVE_MARK: one `[sub-span, { attrKey: undefined }]` per
 * stored range of the mark inside `span` (restricted to `value` when given), so
 * nothing outside an actual mark range is touched (no empty tracked suggestion).
 */
function removalDeltas(
  state: State,
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
  for (const seg of iterateSpan(state, span)) {
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
  key: string,
  value: unknown,
  span: Span | undefined,
  config: EditorConfig,
): EditorState {
  const target = usableSpan(editor, span);
  if (target === null) return editor;
  return applyDeltas(
    editor,
    removalDeltas(editor.state, target, key, value, isNonExclusive(key, config), config.attrRegistry),
    config,
  );
}
