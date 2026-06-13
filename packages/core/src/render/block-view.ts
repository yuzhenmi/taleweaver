import type { BlockId, ReadonlyAttrs, InlineContent, State, SuggestionView } from "../state";
import type { ComputedStyle } from "../styles";
import type { CounterValue } from "../numbering/types";

/**
 * Render-time view of a single block. Components receive this; the
 * renderer constructs it from the underlying State during traversal.
 *
 * Decision B: push-model rendering. The renderer owns traversal;
 * components receive `childRenderNodes` (containers) or `inlineRenderNodes`
 * (leaves) pre-built. BlockView exposes only the current block's own data
 * — no `childIds`, no `parent` (cross-block lookups go through
 * `RenderContext`). `computedStyle` is pre-resolved by the renderer.
 */
export interface BlockViewBase {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly computedStyle: ComputedStyle;
}

/**
 * Container block: holds child blocks. The renderer pre-renders the
 * children and hands them to the component as `childRenderNodes`.
 */
export interface ContainerBlockView extends BlockViewBase {
  readonly kind: "container";
}

/**
 * Leaf block: holds inline content. The renderer expands inline items
 * (text runs into TextBoxes, embed items into ElementBoxes) and hands
 * them to the component as `inlineRenderNodes`.
 *
 * For atomic blocks (image, horizontal-line), `inlineContent.items` is
 * empty by convention; the component reads from `attrs` for rendering
 * inputs.
 */
export interface LeafBlockView extends BlockViewBase {
  readonly kind: "leaf";
  readonly inlineContent: InlineContent;
}

export type BlockView = ContainerBlockView | LeafBlockView;

/**
 * Per-render-cycle context handed to every component's `render`. Carries the
 * read-only `State` and the footnote-number lookup; keeps `BlockView` focused
 * on "this block's data."
 */
export interface RenderContext {
  readonly state: State;
  /**
   * The footnote number (its formatted string, e.g. `"1"`) for a footnote
   * BODY whose root id is `contentBlockId`, or `undefined` if that id is not a
   * footnote body in the current numbering map. Sourced from the same
   * per-render-cycle `footnoteNumbers` map the call-marker reads, so the
   * leading number a footnote body displays (the `::marker`-style "1" at the
   * start of the body in the slot — Google Docs parity) always matches its
   * call marker. The footnote-body component reads this to set its generated
   * `markerText`; the marker is offset-excluded (it does not shift the body's
   * cursor offsets).
   */
  footnoteNumber(contentBlockId: BlockId): string | undefined;
  /**
   * General render-time counter lookup. Returns the computed number for a block
   * within a numbering scope (e.g. a list-item within its listId), or undefined
   * if the block has no counter / the scope isn't numbered this cycle. OPTIONAL
   * so existing stubs and the not-yet-wired path remain valid; the production
   * factory (makeRenderContext) supplies it in a later task. Lists are the first
   * consumer; custom numbered components consume the same API.
   */
  counterValue?(scopeKey: string, blockId: BlockId): CounterValue | undefined;
  /**
   * The change-tracking preview view for this render cycle (slice 5c-iii). Drives
   * `expandInlineItems`' projection of pending suggestions: `"suggesting"`
   * (default) shows the literal document with the 5a/5b suggestion visuals;
   * `"final"` renders as if all suggestions were ACCEPTED (deletion runs + join
   * pilcrows dropped, formatting `proposedAttrs` applied for real, NO suggestion
   * decoration); `"original"` as if all were REJECTED (insertion runs + split
   * pilcrows dropped, formatting proposals dropped, no decoration). OPTIONAL so
   * existing `RenderContext` stubs (which omit it) read as `"suggesting"`; the
   * production factory `makeRenderContext` always supplies it.
   */
  suggestionView?: SuggestionView;
}
