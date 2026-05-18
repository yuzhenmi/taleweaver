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
 */
export interface LeafComponentDefinition {
  readonly type: string;
  readonly kind: "leaf";
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
