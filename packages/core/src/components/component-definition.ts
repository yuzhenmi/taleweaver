import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "../render/block-view";
import type { RenderNode } from "../render/render-node";

/**
 * Component definition for a container block type. Receives a
 * ContainerBlockView, a RenderContext, and the pre-rendered children.
 *
 * Decision B (push-model rendering): the renderer walks the State,
 * dispatches by `view.type` to the right component (container or leaf),
 * and hands in already-rendered children. Components don't traverse —
 * they compose pre-rendered RenderNodes.
 */
export interface ContainerComponentDefinition {
  readonly type: string;
  readonly kind: "container";
  render(
    view: ContainerBlockView,
    context: RenderContext,
    childRenderNodes: ReadonlyArray<RenderNode>,
  ): RenderNode;
}

/**
 * Component definition for a leaf block type. Receives a LeafBlockView,
 * a RenderContext, and the pre-expanded inline items as RenderNodes
 * (TextBoxes for TextItems, ElementBoxes for EmbedItems).
 *
 * Per master spec § "Components" — `text` and `span` are NOT registered.
 * The renderer expands `view.inlineContent.items` directly into
 * `inlineRenderNodes`; leaf components receive them already built.
 *
 * `leafShape` declares the data-model shape this leaf takes — see
 * `state/block-kinds.ts` for the taxonomy. The component registry exposes
 * this via its `BlockKindResolver` implementation so state ops (e.g.,
 * `setBlockType`) can judge shape-compatibility without hardcoding
 * type-string sets:
 *   - "inline-bearing": carries `inlineContent.items` (paragraph, heading,
 *     list-item). Maps to BlockKind "inline-bearing-leaf".
 *   - "atomic": no inlineContent, no children (image, horizontal-line).
 *     Maps to BlockKind "atomic-leaf".
 * (Container components do not declare a `leafShape`; their kind is
 * derived directly from `kind: "container"`.)
 */
export interface LeafComponentDefinition {
  readonly type: string;
  readonly kind: "leaf";
  readonly leafShape: "inline-bearing" | "atomic";
  render(
    view: LeafBlockView,
    context: RenderContext,
    inlineRenderNodes: ReadonlyArray<RenderNode>,
  ): RenderNode;
}

export type ComponentDefinition =
  | ContainerComponentDefinition
  | LeafComponentDefinition;

/**
 * BlockView passed to a component must match its declared kind. Helper
 * type used by the renderer's dispatch to narrow correctly.
 */
export type ViewForKind<K extends "container" | "leaf"> = K extends "container"
  ? ContainerBlockView
  : LeafBlockView;

// Re-export the underlying view types for convenience.
export type { BlockView, ContainerBlockView, LeafBlockView, RenderContext };
