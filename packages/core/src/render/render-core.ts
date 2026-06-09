/**
 * @module render/render-core
 *
 * The shared push-model walker primitives for the render pass. Holds the
 * per-block render body (`renderBlockBody`), the style composition
 * (`composeBlockStyle`), and the inline-item expansion (`expandInlineItems`)
 * used by BOTH the full-render entry (`render.ts`) and the incremental engine
 * (`render-incremental.ts`).
 *
 * Dependency direction: this is the leaf of the render DAG — `render.ts` and
 * `render-incremental.ts` both depend on it, and it depends on neither. Pulling
 * these primitives here breaks the would-be runtime cycle (render-incremental
 * needed `renderBlockBody`, which used to live in `render.ts`, which in turn
 * dispatches into render-incremental for the incremental path).
 */
import {
  resolveBlock,
  asBlockId,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
} from "../state";
import type { Block, BlockId, State, ReadonlyAttrs, InlineContent, CrossReferenceMode } from "../state";
import type { CounterValue } from "../numbering";
import { resolveCrossReference, BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";
import type { Style, ComputedStyle } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { composeComputed } from "../cascade/compose";
import { flattenLengths } from "../cascade/flatten-lengths";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import type { FootnoteNumber } from "../footnotes";
import type {
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "./block-view";
import type { RenderNode } from "./render-node";
import { createTextBox, createElementBox } from "./render-node";
import { buildFootnoteMarker } from "./footnote-marker";

/**
 * The shared per-block render body for both `renderBlock` (full) and
 * `renderBlockIncremental` (cache-aware). The two callers differ ONLY in
 * (a) the incremental variant's cache-lookup preamble (handled by its
 * wrapper before delegating here) and (b) how children recurse — passed
 * in as `recurse` so the full path re-enters `renderBlock` while the
 * incremental path re-enters `renderBlockIncremental` (threading its
 * invalidation set + prev-index). Everything else — the active-path
 * `visited` cycle guard + try/finally drain, the style composition, the
 * component lookup, and the container/leaf dispatch — is identical and
 * lives here so the two paths cannot drift.
 *
 * `recurse(child, parentComputed, parentSpecified)` renders one child,
 * receiving THIS block's computed + specified style as the child's
 * parent context.
 *
 * **`visited` is an ACTIVE-PATH set, drained via `try/finally`.** Re-entry
 * of an id currently on the recursion stack throws (real cycle). An id
 * already drained (i.e., its subtree has finished rendering) does NOT
 * throw on subsequent encounter. The current state-module data model
 * forbids DAG topologies (a `Block` has exactly one `parentId`), so the
 * drain is a defense-in-depth measure that costs one `delete` per block
 * and protects against any future transclusion / shared-subtree work.
 *
 * **`parentSpecified`** is the parent block's translated declarable
 * style (the `Partial<Style>` that `AttrRegistry.applyAll` produced for
 * the parent). Threaded into `composeBlockStyle` so child interpreters
 * that consult `CascadeContext.parentStyle` see the right value. Root
 * call passes `undefined`. Also threaded into `expandInlineItems` so
 * inline interpreters see the containing block's specified style as
 * parent context.
 *
 * **Leaf dispatch (A5):** `def.leafShape === "atomic"` receives `[]`
 * directly — `expandInlineItems` is bypassed so the strut sentinel
 * cannot leak to atomic components. Inline-bearing leaves call
 * `expandInlineItems` as normal.
 */
export function renderBlockBody(
  block: Block,
  parentComputed: ComputedStyle | null,
  parentSpecified: Partial<Style> | undefined,
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  context: RenderContext,
  visited: Set<BlockId>,
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
  numbering: ReadonlyMap<BlockId, CounterValue>,
  recurse: (
    child: Block,
    parentComputed: ComputedStyle | null,
    parentSpecified: Partial<Style> | undefined,
  ) => RenderNode,
): RenderNode {
  if (visited.has(block.id)) {
    throw new Error(`render: cycle detected at block "${block.id}"`);
  }
  visited.add(block.id);
  try {
    const { specified, computed } = composeBlockStyle(
      block.attrs,
      parentComputed,
      parentSpecified,
      attrRegistry,
    );

    const def = componentRegistry.get(block.type);
    if (def === undefined) {
      throw new Error(`render: no component registered for block type "${block.type}"`);
    }

    if (def.kind === "container") {
      const view: ContainerBlockView = Object.freeze({
        id: block.id,
        type: block.type,
        attrs: block.attrs,
        computedStyle: computed,
        kind: "container" as const,
      });
      const childRenderNodes: RenderNode[] = [];
      let childId = block.firstChildId;
      while (childId !== null) {
        // Walk via resolveBlock (main → embed → template) so a container
        // body nested in embedContents/templateContents resolves its
        // children, which live in the same content Y.Map. For main-tree
        // blocks resolveBlock's first arm is getBlock → identical.
        const child = resolveBlock(state, childId)?.block ?? null;
        if (child === null) {
          throw new Error(`render: child "${childId}" of "${block.id}" not found in any tree`);
        }
        childRenderNodes.push(recurse(child, computed, specified));
        childId = child.nextSiblingId;
      }
      return def.render(view, context, childRenderNodes);
    }

    // Exhaustiveness backstop: the container branch returns, so `def` is the
    // leaf variant here. If a third component `kind` is ever added, this line
    // fails to compile — forcing the new kind to be handled rather than silently
    // falling through to the leaf path.
    def.kind satisfies "leaf";

    // Leaf: build LeafBlockView, expand inline items (only for
    // inline-bearing leaves), dispatch.
    const inline: InlineContent = block.inlineContent ?? { items: [] };
    const view: LeafBlockView = Object.freeze({
      id: block.id,
      type: block.type,
      attrs: block.attrs,
      computedStyle: computed,
      kind: "leaf" as const,
      inlineContent: inline,
    });
    // A5: atomic-leaf components (image, horizontal-line, …) MUST NOT
    // receive a strut sentinel. The convention used to be "atomic
    // components ignore inlineRenderNodes by reading attrs instead"; we
    // now enforce it at the dispatch site so third-party atomic
    // components can't accidentally consume the sentinel.
    const inlineRenderNodes: ReadonlyArray<RenderNode> = def.leafShape === "atomic"
      ? []
      : expandInlineItems(block.id, inline, specified, attrRegistry, fnNumbers, state, numbering);
    return def.render(view, context, inlineRenderNodes);
  } finally {
    // A2: visited tracks the ACTIVE recursion path, not the cumulative
    // set of visited blocks. Draining on every exit (including throws)
    // means the same id appearing in two disjoint subtrees is fine, and
    // a real cycle still fires the throw because the id is still on the
    // active path when we re-encounter it.
    visited.delete(block.id);
  }
}

/**
 * Compose computedStyle for a block: run the injected interpreters over
 * the block's attrs, compose against parent + initial, then flatten ems
 * against own fontSize. The full canonical cascade pipeline — matches
 * what cascadePass does for the legacy renderer's tree.
 *
 * Returns BOTH the intermediate `specified` (the Partial<Style> emitted
 * by `attrRegistry.applyAll`) and the final `computed` style. Callers
 * thread `specified` to child blocks via `CascadeContext.parentStyle`
 * so context-sensitive interpreters can consult parent declarations
 * without needing a separate cascade pass.
 */
export function composeBlockStyle(
  attrs: ReadonlyAttrs,
  parentComputed: ComputedStyle | null,
  parentSpecified: Partial<Style> | undefined,
  attrRegistry: AttrRegistry,
): { specified: Partial<Style>; computed: ComputedStyle } {
  const specified: Partial<Style> = attrRegistry.applyAll(attrs, {
    parentStyle: parentSpecified,
  });
  const base = parentComputed ?? INITIAL_COMPUTED_STYLE;
  const composed = composeComputed(specified, base);
  return { specified, computed: flattenLengths(composed) };
}

/**
 * Expand inline content items into RenderNodes. Per master spec § text/span
 * removal: no `text` or `span` component dispatch — the renderer directly
 * emits TextBoxes for TextItems and ElementBoxes for EmbedItems.
 *
 * Keys are scoped under the leaf block id (`${blockId}/inline/${i}`) so
 * they're stable across re-renders of the same block but won't collide
 * with sibling-block keys (each block's keys live under its own id
 * prefix).
 *
 * `computedStyle` is intentionally NOT attached here. The downstream
 * `cascadePass` populates it for every RenderNode in the tree; pre-filling
 * would just be overwritten and would create new identities per render.
 *
 * Inline interpreters receive `{ parentStyle: blockSpecified }` so any
 * inline-attr interpreter that consults parent context (e.g., explicit
 * inheritance flags) sees the block's declared style as parent.
 */
export function expandInlineItems(
  blockId: BlockId,
  content: InlineContent,
  blockSpecified: Partial<Style>,
  attrRegistry: AttrRegistry,
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
  state: State,
  numbering: ReadonlyMap<BlockId, CounterValue>,
): RenderNode[] {
  const out: RenderNode[] = [];
  let i = 0;
  for (const item of content.items) {
    const itemStyle: Partial<Style> = attrRegistry.applyAll(item.attrs, {
      parentStyle: blockSpecified,
    });
    const key = `${blockId}/inline/${i}`;
    if (item.kind === "text") {
      // InlineItem narrows to TextItem here via the discriminated union.
      out.push(createTextBox(key, itemStyle, item.text));
    } else if (item.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE) {
      // FN-2: a footnote-anchor embed renders as the superscript call marker
      // (a small, raised number) instead of the invisible zero-width embed
      // box. Its number comes from the FN-3 numbering map, keyed by the
      // anchor's `properties.contentBlockId`. The marker is still ONE
      // inline-block = exactly one cursor stop (the IFC emits one atomic token
      // per inline-block regardless of its children), so the state-model
      // offset accounting is unchanged from a plain embed.
      const contentBlockId = item.properties.contentBlockId;
      const formatted =
        typeof contentBlockId === "string"
          ? fnNumbers.get(asBlockId(contentBlockId))?.formatted
          : undefined;
      out.push(
        // Same closed-struct marker metadata as the plain-embed branch below:
        // the embed-kind discriminator + the footnote body's `contentBlockId`
        // (the only property a footnote anchor carries).
        buildFootnoteMarker(key, itemStyle, formatted, {
          embedType: item.embedType,
          contentBlockId,
        }),
      );
    } else if (item.embedType === CROSS_REFERENCE_EMBED_TYPE) {
      // A cross-reference field renders its RESOLVED string (the target's number or
      // text) as ONE inline-block ATOM — exactly one IFC token = one cursor stop,
      // matching the state model's 1-unit offset for an EmbedItem. A plain
      // `createTextBox(resolved)` would tokenize the string into len(text) IFC
      // tokens and drift the per-line offset accumulator by len−1, corrupting
      // cursor/hit-test for everything after the field (see resolveCrossReference
      // + the spec's S3 correction). The inline-block emits one atomic token
      // regardless of its child text (the footnote-marker invariant) and is
      // atomic-for-editing, matching Google Docs fields.
      const targetId = item.properties.targetId;
      const refMode = item.properties.refMode;
      const resolved =
        typeof targetId === "string" && (refMode === "number" || refMode === "text")
          ? resolveCrossReference(state, numbering, {
              targetId: asBlockId(targetId),
              refMode: refMode as CrossReferenceMode,
            })
          : BROKEN_CROSS_REFERENCE_TEXT;
      out.push(
        createElementBox(
          key,
          // `display: "inline-block"` is spread LAST so it ALWAYS wins over
          // `itemStyle`: the single-token atomicity is load-bearing for the IFC
          // offset accounting (one EmbedItem = one cursor stop), not a stylistic
          // default. This deliberately differs from the footnote marker, whose
          // defaults-first order lets `itemStyle` override `display` — here the
          // invariant must not be overridable. The embed's own attrs (font, etc.)
          // still apply via `itemStyle`.
          { ...itemStyle, display: "inline-block" },
          // Inner text gets `{}` (not `itemStyle`): it inherits font/etc. from the
          // container's cascade. Re-applying `itemStyle` here would DOUBLE-apply
          // em-relative properties (e.g. a `1.5em` fontSize compounds to 2.25×).
          // Mirrors `buildFootnoteMarker`'s empty-style inner text child.
          [createTextBox(`${key}/0`, {}, resolved)],
          // Only `embedType` — a cross-reference is a POINTER with no owned body,
          // so (unlike the footnote anchor) there is no `contentBlockId` to stamp.
          // The target lives in `properties.targetId`; downstream navigation
          // (a later slice) reads it from state, not from box metadata.
          { embedType: item.embedType },
        ),
      );
    } else if (
      item.embedType === COMMENT_START_EMBED_TYPE ||
      item.embedType === COMMENT_END_EMBED_TYPE ||
      item.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE ||
      item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
    ) {
      // The comment-range markers AND the change-tracking break-suggestion
      // embeds (`block-join-suggestion` / `block-split-suggestion`) share this
      // branch: each is a ZERO-WIDTH INLINE-BLOCK ATOM. (The visible struck/added
      // pilcrow for the break embeds is slice 5; slice 1 only preserves the
      // offset invariant.)
      //
      // A comment-range marker is a ZERO-WIDTH INLINE-BLOCK ATOM: it occupies
      // exactly one state-model `Position` offset (atomic embed) and must emit
      // exactly ONE IFC token — like every other embed — so the IFC's per-line
      // offset cursor (`inlineOffsetStart`/`inlineOffsetEnd`) advances past it.
      // The `offset↔box` 1:1 invariant (#407) is load-bearing: the line index
      // IS token-driven, so SKIPPING emission would leave `inlineOffsetEnd`
      // short by the marker count and corrupt cursor/hit-test for every offset
      // after a marker on the line. It differs from the footnote-anchor (a
      // VISIBLE superscript marker) and the cross-reference (a visible resolved
      // string) in that it renders NOTHING VISIBLE — an empty inline-block of
      // width 0: no glyph, no U+FFFC placeholder. The comment highlight is a
      // separate paint overlay derived from the marker scan (a later slice),
      // NOT this render-tree box. Reuses the same zero-width-inline-block shape
      // as the empty-embed branch below (defaults `inlineSize: 0` so the
      // inline-block intrinsic sizing does NOT apply its empty-content 100px
      // fallback). `display: "inline-block"` is spread LAST so the
      // single-token atomicity is not overridable by `itemStyle` (the IFC
      // offset accounting is load-bearing, matching the cross-reference
      // branch's precedence, not the footnote marker's).
      out.push(
        createElementBox(
          key,
          { ...itemStyle, inlineSize: 0, display: "inline-block" },
          // No children → no glyph, no text. One atomic IFC token, 0px wide.
          [],
          // Stamp the embed kind so downstream cursor/hit-test/comment-overlay
          // can recognize the marker box without re-deriving it from state. A
          // comment marker is a POINTER (its `commentId` lives in `properties`,
          // read from state by the overlay), so — like the cross-reference —
          // there is no `contentBlockId` body to stamp.
          { embedType: item.embedType },
        ),
      );
    } else {
      // InlineItem narrows to EmbedItem here.
      //
      // Exhaustiveness backstop: the `text` arm handled the only other
      // `InlineItem` variant, so `item.kind` is `"embed"` in this final else.
      // If a third inline-item kind is ever added to the `InlineItem` union,
      // this `satisfies` fails to compile — forcing the new kind to be handled
      // rather than silently routing through the embed path. (Mirrors the
      // `def.kind satisfies "leaf"` backstop in `renderBlockBody`.)
      item.kind satisfies "embed";
      //
      // Embeds are emitted as `display: inline-block` so the IFC's
      // token stream represents the state-model 1-unit cursor
      // contribution (per `state/block-position.ts`). With default
      // `display: inline`, an embed with no children produces no
      // tokens and the IFC's per-line offset accumulator drifts from
      // the state-model offset by 1 per embed. As `inline-block`
      // (width = intrinsic content size, typically 0 for atomic
      // embeds), the IFC emits exactly one atomic token contributing
      // 1 to the offset cursor and an `InlineBlockBox` of width 0
      // in the line — invisible visually, correct for cursor /
      // hit-test offset math.
      // Defaults FIRST so attr-interpreter-supplied values in
      // `itemStyle` (a visible embed with its own `inlineSize` /
      // alternative `display`) override the atomic-anchor fallbacks.
      const embedStyle: Partial<Style> = {
        display: "inline-block",
        // Default inline-block intrinsic sizing applies a 100px
        // fallback for empty content (per ifc.ts `inlineSizePx > 0 ?
        // inlineSizePx : 100`). Atomic embed anchors have no content
        // to size against, so default width to 0 — the embed is an
        // invisible cursor-position marker, not a visual element.
        // A visible embed component overrides this via its attr
        // interpreter.
        inlineSize: 0,
        ...itemStyle,
      };
      out.push(
        // Embed-anchor marker metadata: the embed-kind discriminator plus the
        // linked embed-content root id from the embed's open `properties` bag.
        // `contentBlockId` is the only property any embed produces or any
        // consumer reads off the marker box today (typed `unknown`, coerced at
        // the read site); narrowing the stamp to it (vs spreading the whole
        // open `properties` bag) keeps `LayoutBoxMetadata` a closed struct. If
        // a future embed surfaces another marker property, add it here and to
        // the type together.
        createElementBox(key, embedStyle, [], {
          embedType: item.embedType,
          contentBlockId: item.properties.contentBlockId,
        }),
      );
    }
    i++;
  }

  // Empty-paragraph strut sentinel: when an inline-bearing leaf block has
  // no inline items (e.g. an empty paragraph after the user pressed
  // Enter), the layout pipeline keys IFC dispatch off the presence of
  // inline children. To ensure the IFC is invoked — so its zero-tokens
  // path emits the strut LineBox carrying one line-height of vertical
  // space (browser-faithful empty-<p> behavior) — we emit a single empty
  // TextBox here. Its empty text produces zero tokens
  // (collectInlineTokens short-circuits on empty text), so the only
  // effect is triggering IFC dispatch. Atomic-leaf components (image,
  // horizontal-line) bypass this function entirely (see renderBlock's
  // leafShape === "atomic" branch), so they never see the sentinel.
  if (out.length === 0) {
    out.push(createTextBox(`${blockId}/inline/0`, {}, ""));
  }

  return out;
}
