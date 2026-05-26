import type { BlockId, ReadonlyAttrs, InlineContent, State } from "../state";
import type { ComputedStyle } from "../styles";

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
 * Render-time escape hatch for cross-block lookups (footnote-anchor →
 * footnote body via getEmbedContent; future cross-references via
 * getView). Keeps BlockView focused on "this block's data."
 *
 * In P7 these accessors throw — no consumer needs them yet. P10+ phases
 * (cursor positioning, cross-references) wire them up via a per-block
 * view cache. The signature is shipped now so component implementations
 * landing in P8 can be written against the final RenderContext shape.
 */
export interface RenderContext {
  readonly state: State;
  getView(id: BlockId): BlockView;
  getEmbedContent(id: BlockId): BlockView;
}
