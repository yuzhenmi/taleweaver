/**
 * @module render/render-footnotes
 *
 * Footnote-numbering glue for the render pass: the bridge between the pure
 * footnotes module (numbering policy, anchor collection) and the render
 * walker. Holds the render-only policy adjustment (`effectiveRenderPolicy`),
 * the `RenderContext` factory that wires the body's leading-number lookup
 * (`makeRenderContext`), and the FN-8 incremental anchor-reuse guard
 * (`footnoteAnchorsUnchanged` and its helpers).
 *
 * Dependency direction: this module imports render-side TYPES
 * (`RenderContext`, `RenderOutput`) via `import type` ONLY, so no runtime
 * cycle forms with `render.ts` / `render-incremental.ts`, which import these
 * functions back.
 */
import {
  getBlock,
  docHasFootnotes,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
} from "../state";
import type { Block, BlockId, State, SuggestionView } from "../state";
import {
  documentFootnotePolicy,
  SECTION_BLOCK_TYPE,
  type FootnoteNumber,
  type FootnoteNumberingPolicy,
} from "../footnotes";
import type { CounterValue } from "../numbering/types";
import type { RenderContext } from "./block-view";
import type { RenderOutput } from "./render";

/**
 * FN-6.3: the EFFECTIVE footnote numbering policy for the RENDER pass. Reads the
 * document-level policy from the root block's raw attrs (`documentFootnotePolicy`
 * — the Google Docs default `{ continuous, decimal }` when unset/invalid), then
 * applies one render-only adjustment:
 *
 * **restart-per-page falls back to continuous here.** `restart-per-page`
 * numbering depends on which page each footnote lands on, which is only known
 * AFTER the `resolveFootnotes` layout pass (FN-4/FN-6.4). The render pass has no
 * `pageAssignment`, and `footnoteNumbers` THROWS for `restart-per-page` without
 * one. Substituting `continuous` renders a valid (if not yet per-page) sequence
 * instead of crashing. This is the documented FN-6.3 → FN-6.4 phasing: FN-6.3
 * lands the policy infrastructure; FN-6.4's two-pass cycle feeds per-page numbers
 * from `resolveFootnotes` into the markers. Continuous and restart-per-section are
 * state-derivable and pass through unchanged.
 */
export function effectiveRenderPolicy(state: State): FootnoteNumberingPolicy {
  const policy = documentFootnotePolicy(state);
  return policy.reset === "restart-per-page"
    ? { ...policy, reset: "continuous" }
    : policy;
}

/**
 * FN-8: shared frozen empty numbering map for the footnote-free path. A document
 * with no footnotes (`docHasFootnotes(state) === false`) skips the O(N_blocks)
 * `collectFootnoteAnchors` walk entirely and uses `EMPTY_FOOTNOTE_ANCHORS` (from
 * the footnotes module) + this empty map instead — identical downstream behavior
 * (the walk would have returned `[]` and built an empty numbering map), minus the
 * walk.
 */
export const EMPTY_FOOTNOTE_NUMBERS: ReadonlyMap<BlockId, FootnoteNumber> =
  Object.freeze(new Map<BlockId, FootnoteNumber>());

/**
 * Build the per-render-cycle `RenderContext`. `footnoteNumber` is wired: it
 * reads `fnNumbers` — the SAME numbering map already computed once this cycle
 * for the call markers — so a footnote body's leading number (its generated
 * `markerText`) shares the SAME counter value as its anchor's superscript call
 * marker. The body marker, however, reads like a numbered-list item: it appends
 * a trailing `"."` (list-style suffix) to the bare counter, so the bottom-slot
 * BODY marker reads "1." while the inline superscript CALL marker stays bare
 * ("1"). The `symbol` format is EXEMPT from the dot (*, †, ‡ take no suffix —
 * Chicago / Word / Google Docs convention), so a symbol footnote reads "*" in
 * both slots. The doc-wide format is read once here to decide the suffix. Both
 * render paths (full + incremental) construct the context through here so the
 * body number renders identically regardless of path.
 */
export function makeRenderContext(
  state: State,
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
  listCounters: ReadonlyMap<BlockId, CounterValue>,
  suggestionView: SuggestionView = "suggesting",
): RenderContext {
  const format = documentFootnotePolicy(state).format;
  const suffix = format === "symbol" ? "" : ".";
  return {
    state,
    suggestionView,
    footnoteNumber: (contentBlockId: BlockId): string | undefined => {
      const formatted = fnNumbers.get(contentBlockId)?.formatted;
      return formatted === undefined ? undefined : formatted + suffix;
    },
    // List-item marker lookup. `listCounters` is the per-cycle numbering map
    // computed once in `render.ts` from the document's list events + defs. The
    // map is keyed by blockId (each block is in exactly one scope), so the
    // `scopeKey` (listId) is not needed for the lookup — mirroring the by-id
    // `footnoteNumber` lookup above.
    counterValue: (
      _scopeKey: string,
      blockId: BlockId,
    ): CounterValue | undefined => listCounters.get(blockId),
  };
}

/**
 * FN-8: decide whether the prior render cycle's cached footnote anchors (and
 * thus the derived continuous numbering) can be REUSED for this incremental
 * cycle, skipping the O(N_blocks) `collectFootnoteAnchors` walk.
 *
 * Reuse is allowed iff ALL of:
 *  1. the document has footnotes (`docHasFootnotes`) — a footnote-free doc has
 *     no cached anchors worth reusing and takes the empty-list short-circuit;
 *  2. NO block in `dirtyIds` carries a footnote anchor in its NEW (current
 *     state) OR PREV (prevState) inline content — the complete test for an
 *     anchor add / remove / move, since every such block is dirty and either
 *     its new content (added/moved) or its prev content (removed/moved) holds
 *     the anchor; and
 *  3. NO block in `dirtyIds` is a `section`-type block in the new OR prev state
 *     — a section change can rescope an anchor (its enclosing `sectionId`),
 *     which the restart-per-section policy depends on.
 *
 * Moving a NON-anchor block cannot reorder anchors, so it does not block reuse.
 */
export function footnoteAnchorsUnchanged(
  state: State,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
  prev: RenderOutput,
): boolean {
  if (!docHasFootnotes(state)) return false;
  // Reuse only when `prev` actually cached anchors. Every render path (full +
  // incremental) populates `footnoteAnchors` whenever the doc has footnotes, so
  // this is true on any normal `prev`; the check doubles as the guard that we
  // have a list to reuse before scanning the dirty set.
  if (prev.footnoteAnchors.length === 0) return false;
  // FN-6.3: the numbering map also depends on the DOCUMENT-LEVEL policy, which
  // lives in the ROOT block's raw attrs (read by `documentFootnotePolicy`). A
  // policy change dirties the root but touches no anchor-bearing or section
  // block, so the per-block scan below would NOT catch it — reusing the stale
  // numbers. Force a recompute whenever the policy-bearing root is dirty (O(1)).
  if (dirtyIds.has(state.rootId)) return false;
  for (const id of dirtyIds) {
    if (blockIsSection(state, id) || blockIsSection(prevState, id)) return false;
    if (
      blockHasFootnoteAnchor(getBlock(state, id)) ||
      blockHasFootnoteAnchor(getBlock(prevState, id))
    ) {
      return false;
    }
  }
  return true;
}

/** True if `block` (a main-tree block, or null) carries a footnote-anchor embed. */
export function blockHasFootnoteAnchor(block: Block | null): boolean {
  if (block === null || block.inlineContent === null) return false;
  for (const item of block.inlineContent.items) {
    if (item.kind === "embed" && item.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE) {
      return true;
    }
  }
  return false;
}

/** True if the block with `id` in `state` is a `section`-type block. */
export function blockIsSection(state: State, id: BlockId): boolean {
  return getBlock(state, id)?.type === SECTION_BLOCK_TYPE;
}
