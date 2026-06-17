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
  getOutline,
  asBlockId,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
  PAGE_FIELD_EMBED_TYPE,
  INLINE_IMAGE_EMBED_TYPE,
  PAGE_FIELD_RESERVED_GLYPHS,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  readSuggestionRecordFromState,
  itemVisibleInView,
} from "../state";
import type {
  Block,
  BlockId,
  State,
  ReadonlyAttrs,
  InlineContent,
  CrossReferenceMode,
  SuggestionId,
  SuggestionRecord,
  SuggestionView,
} from "../state";
import { authorColorOf } from "../styles";
import type { CounterValue } from "../numbering";
import { resolveCrossReference, BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";
import { inlineRenderKey } from "./inline-render-key";
import {
  isPageFieldKind,
  isPageFieldNumberStyle,
  type PageFieldKind,
  type PageFieldNumberStyle,
} from "../state";
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
import type { ElementBox, RenderNode } from "./render-node";
import { createTextBox, createElementBox } from "./render-node";
import { buildFootnoteMarker } from "./footnote-marker";
import { buildTocEntrySubtree } from "./toc-entry-subtree";
import type { TocAttrs } from "../components/table-of-contents-attrs";
import {
  tocLevelsFromAttrs,
  tocLeaderFromAttrs,
  tocShowPageNumbersFromAttrs,
  tocIndentStepFromAttrs,
} from "../components/table-of-contents-attrs";

/**
 * The pilcrow (U+00B6 ¶) glyph a change-tracking break-suggestion embed renders
 * (slice 5b) — a split shows it underlined (insertion), a join struck (deletion).
 */
const PILCROW = "¶";

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

    // A live Table of Contents synthesizes its entry lines from the document
    // outline at render time (derive-not-store), BEFORE the generic component
    // dispatch — the `table-of-contents` component would otherwise return its
    // zero-height stub placeholder. The entry subtree is page-agnostic; each
    // entry's page-number atom is a `"page"`-mode cross-ref bound late at
    // materialize (the shipped `collectPageFields` seam, keyed `${tocId}/toc/${i}`).
    // NOTE: `renderBlockIncremental` reuses a stale TOC node when a heading
    // changes but the TOC block is not itself dirty; that incremental
    // outline-staleness is handled by the forthcoming `outlineSignature`
    // invalidation (NOT this slice).
    if (block.type === "table-of-contents") {
      return renderTocBlock(block, state, context.suggestionView ?? "suggesting");
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
      : expandInlineItems(
          block.id,
          inline,
          specified,
          attrRegistry,
          fnNumbers,
          state,
          numbering,
          context.suggestionView ?? "suggesting",
        );
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
 * Render a live Table of Contents block: read the TOC options off the block's
 * attrs (via the same validators the component uses), derive the document
 * outline, and synthesize one entry-line box per qualifying heading. The TOC
 * box is a `display: block` container whose children are the synthesized entry
 * lines (which inherit body font/etc. from the parent through this minimal
 * style). The `tableOfContents` metadata keeps the box recognizable to the DOM
 * controller's TOC hit-test (mirroring the stub the component used to emit).
 */
function renderTocBlock(block: Block, state: State, suggestionView: SuggestionView): ElementBox {
  const attrs: TocAttrs = {
    levels: tocLevelsFromAttrs(block.attrs.levels),
    leader: tocLeaderFromAttrs(block.attrs.leader),
    showPageNumbers: tocShowPageNumbersFromAttrs(block.attrs.showPageNumbers),
    indentStep: tocIndentStepFromAttrs(block.attrs.indentStep),
  };
  const outline = getOutline(state, { suggestionView });
  const entries = buildTocEntrySubtree(outline, attrs, block.id);
  return createElementBox(block.id, { display: "block" }, entries, { tableOfContents: true });
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
  view: SuggestionView = "suggesting",
): RenderNode[] {
  // Change-tracking slice 5c-iii: in a non-`"suggesting"` preview view the
  // suggestion VISUALS (5a/5b) are suppressed — the document is rendered as it
  // would read once accepted (`"final"`) / rejected (`"original"`). Preview views
  // are NON-editable, so dropping resolved-away items here does not affect the
  // (suggesting-only) cursor/hit-test offset accounting.
  const suppressVisuals = view !== "suggesting";
  const out: RenderNode[] = [];
  let i = 0;
  for (const item of content.items) {
    // 5c-iii: drop items resolved AWAY in this view (final: deletions + joins;
    // original: insertions + splits). `i` still advances so render keys stay
    // stable across the literal item list.
    if (!itemVisibleInView(item, view)) {
      i++;
      continue;
    }
    const itemStyle: Partial<Style> = attrRegistry.applyAll(item.attrs, {
      parentStyle: blockSpecified,
    });
    const key = inlineRenderKey(blockId, i);
    if (item.kind === "text") {
      // InlineItem narrows to TextItem here via the discriminated union.
      // Change-tracking slice 5a/5c-iii: in `"suggesting"` view, layer the
      // suggestion visuals (author color + underline/lineThrough + formatting
      // preview) on top of the cascaded itemStyle. In a preview view, suppress
      // those visuals — but in `"final"` apply a formatting proposal FOR REAL.
      const runStyle = resolveSuggestionStyle(
        item.attrs,
        itemStyle,
        state,
        attrRegistry,
        blockSpecified,
        view,
      );
      const linkAttr = item.attrs.link;
      out.push(
        createTextBox(
          key,
          runStyle,
          item.text,
          typeof linkAttr === "string" ? linkAttr : undefined,
        ),
      );
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
      if (refMode === "page") {
        // A `"page"`-mode cross-reference is a LAYOUT-dependent field: the target's
        // page number is unknown at render time (it depends on PAGINATION, which
        // does not exist yet). Like a page-field, it renders a PLACEHOLDER of N
        // reserved sizing glyphs (PAGE_FIELD_RESERVED_GLYPHS); the real value is
        // bound LATE at materialize (the layout collect→resolve→substitute seam),
        // which discriminates this branch on `embedType === "cross-reference"
        // && refMode === "page"` and reads `targetId` + `numberStyle` from the box
        // metadata. The `"number"`/`"text"` branches below still resolve at render
        // time (no layout dependency). One inline-block atom = one IFC token = one
        // cursor stop (#407), exactly as the resolved branch.
        const rawStyle = item.properties.numberStyle;
        const numberStyle: PageFieldNumberStyle = isPageFieldNumberStyle(rawStyle)
          ? rawStyle
          : "decimal";
        const placeholder = "0".repeat(PAGE_FIELD_RESERVED_GLYPHS);
        out.push(
          createElementBox(
            key,
            // `display: "inline-block"` spread LAST — the single-token atomicity is
            // load-bearing for IFC offset accounting, not a stylistic default
            // (mirrors the resolved cross-ref + page-field branches).
            { ...itemStyle, display: "inline-block" },
            // Inner text gets `{}` (inherits font/etc. from the cascade — re-applying
            // `itemStyle` would double-apply em-relative properties).
            [createTextBox(`${key}/0`, {}, placeholder)],
            // R-F2: the metadata MUST carry `refMode` (not just targetId/numberStyle)
            // so the later collect/patch passes' `refMode === "page"` dispatch guard
            // actually fires. `targetId` rides the validated string from the embed's
            // `properties` (a malformed non-string → `null`, mapped to broken-ref at
            // substitution).
            {
              embedType: item.embedType,
              refMode: "page",
              targetId: typeof targetId === "string" ? targetId : null,
              numberStyle,
            },
          ),
        );
      } else {
        const resolved =
          typeof targetId === "string" && (refMode === "number" || refMode === "text")
            ? resolveCrossReference(
                state,
                numbering,
                {
                  targetId: asBlockId(targetId),
                  refMode: refMode as CrossReferenceMode,
                },
                view,
              )
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
            // `embedType` plus `targetId`: a cross-reference is a POINTER with no
            // owned body, so (unlike the footnote anchor) there is no
            // `contentBlockId` to stamp. `targetId` is threaded onto the atom in
            // EVERY ref mode (number/text — the page branch above stamps it too) so
            // the PDF exporter can emit an internal /GoTo link to the target block
            // (#522). A malformed non-string target maps to `null` (broken ref).
            { embedType: item.embedType, targetId: typeof targetId === "string" ? targetId : null },
          ),
        );
      }
    } else if (item.embedType === PAGE_FIELD_EMBED_TYPE) {
      // A page-field (page-number / page-count) renders a PLACEHOLDER at render
      // time — its real value depends on PAGINATED layout, which does not exist
      // yet. The placeholder is N reserved sizing glyphs (PAGE_FIELD_RESERVED_GLYPHS);
      // with `inlineSize: auto` (the default — not set here) the IFC shrink-to-fits
      // the atom to those glyphs' natural width = the reserved width, so line/slot
      // layout already accounts for the widest plausible value. The per-page value
      // is bound LATE, at materialize (substituteLayoutFields). Like
      // the cross-reference embed, one inline-block atom = one IFC token = one
      // cursor stop (#407); the `fieldKind`/`numberStyle` ride in metadata for the
      // layout field-resolution pass to read (the render tree stays page-agnostic).
      // Both narrowed from the embed's open-schema `unknown` properties via type
      // guards (no cast); a malformed / future value falls back to the default.
      const rawKind = item.properties.fieldKind;
      const fieldKind: PageFieldKind = isPageFieldKind(rawKind) ? rawKind : "page-number";
      const rawStyle = item.properties.numberStyle;
      const numberStyle: PageFieldNumberStyle = isPageFieldNumberStyle(rawStyle) ? rawStyle : "decimal";
      const placeholder = "0".repeat(PAGE_FIELD_RESERVED_GLYPHS);
      out.push(
        createElementBox(
          key,
          // `display: "inline-block"` spread LAST — the single-token atomicity is
          // load-bearing for IFC offset accounting, not a stylistic default
          // (mirrors the cross-reference branch).
          { ...itemStyle, display: "inline-block" },
          // Inner text gets `{}` (inherits font/etc. from the cascade — re-applying
          // `itemStyle` would double-apply em-relative properties).
          [createTextBox(`${key}/0`, {}, placeholder)],
          { embedType: item.embedType, fieldKind, numberStyle },
        ),
      );
    } else if (
      item.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE ||
      item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
    ) {
      // Change-tracking slice 5b: a suggested paragraph break renders as a
      // VISIBLE pilcrow (¶) carrying the suggestion's author color, mirroring the
      // text-run visuals (slice 5a): a SPLIT is an INSERTION (author color +
      // underline), a JOIN is a DELETION (author color + lineThrough). Like the
      // cross-reference embed, the glyph is wrapped in a SINGLE inline-block ATOM
      // so it emits exactly ONE IFC token (one state-model offset) regardless of
      // the glyph's width — preserving the offset↔box 1:1 invariant the break
      // embed relies on (#407). The owning record (read by `properties.suggestionId`)
      // supplies the author color; an absent record (collab race / migration)
      // leaves `color` to the cascade but still marks the decoration (the embed
      // TYPE alone determines split=underline / join=lineThrough).
      // 5c-iii: in a preview view a SURVIVING break embed (a split accepted in
      // `"final"`, a join rejected in `"original"`) is resolved INTO the document
      // structure — its break is the block boundary itself, so it shows NO visible
      // pilcrow. Render it as a zero-width inline-block atom (mirrors the
      // comment-marker shape). (Structurally MERGING the two blocks for an
      // accepted-join / rejected-split is the carved `5c-structural` sub-slice.)
      if (suppressVisuals) {
        out.push(
          createElementBox(
            key,
            { ...itemStyle, inlineSize: 0, display: "inline-block" },
            [],
            { embedType: item.embedType },
          ),
        );
      } else {
        const isSplit = item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE;
        const rawId = item.properties.suggestionId;
        const record =
          typeof rawId === "string"
            ? readSuggestionRecordFromState(state, rawId as SuggestionId)
            : null;
        const authorColor = record !== null ? authorColorOf(record.author) : null;
        // The inner glyph carries ONLY the suggestion decoration overrides (color +
        // underline/lineThrough); it inherits font/size from the container's cascade
        // — re-applying `itemStyle` here would DOUBLE-apply em-relative properties
        // (mirrors the cross-reference branch's empty-style inner child).
        const glyphStyle: Partial<Style> = {
          ...(authorColor !== null ? { color: authorColor } : {}),
          ...(isSplit ? { underline: true } : { lineThrough: true }),
        };
        out.push(
          createElementBox(
            key,
            // `display: "inline-block"` spread LAST so the single-token atomicity
            // always wins over `itemStyle` (the IFC offset accounting is
            // load-bearing) — matching the cross-reference branch's precedence.
            { ...itemStyle, display: "inline-block" },
            [createTextBox(`${key}/0`, glyphStyle, PILCROW)],
            { embedType: item.embedType },
          ),
        );
      }
    } else if (
      item.embedType === COMMENT_START_EMBED_TYPE ||
      item.embedType === COMMENT_END_EMBED_TYPE
    ) {
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
    } else if (item.embedType === INLINE_IMAGE_EMBED_TYPE) {
      // An inline image (Google Docs "In line" positioning) renders as ONE
      // inline-block ATOM (one IFC token = the state model's 1-unit EmbedItem
      // offset, #407) — exactly like the other visible embeds. Option B layers
      // it as an OUTER `display:inline-block` ElementBox carrying
      // `metadata.replacedInline: true` (so the T2 replaced-baseline rule fires:
      // the box's BOTTOM edge sits on the text baseline, CSS2 §10.8.1) wrapping
      // ONE INNER `display:block` ElementBox that carries the SAME
      // `metadata.image { src, width, height }` + explicit `blockSize`/`inlineSize`
      // a BLOCK image stamps (see `components/image.ts`). Reusing the block-image
      // box means the existing block-image paint runs for free via
      // `paintContainerChildren` recursion — canvas AND PDF paint with zero new
      // paint code. The same string/numeric guards block images use coerce the
      // open `properties` bag (`src` defaults `""`, missing/garbage dims default
      // `0`, matching the block-image metadata default).
      const src = typeof item.properties.src === "string" ? item.properties.src : "";
      const width = typeof item.properties.width === "number" ? item.properties.width : 0;
      const height = typeof item.properties.height === "number" ? item.properties.height : 0;
      const alt = typeof item.properties.alt === "string" ? item.properties.alt : "";
      const inner = createElementBox(
        // Mirror the sibling embeds' inner-child key derivation (`${key}/0`).
        `${key}/0`,
        { display: "block", blockSize: height, inlineSize: width },
        [],
        { image: { src, width, height, alt } },
      );
      out.push(
        createElementBox(
          key,
          // `display: "inline-block"` spread LAST — the single-token atomicity is
          // load-bearing for IFC offset accounting, not a stylistic default
          // (mirrors the cross-reference/page-field branches). The embed's own
          // attrs (link, comment-range, etc.) still apply via `itemStyle`.
          { ...itemStyle, display: "inline-block" },
          [inner],
          // `replacedInline` makes the IFC use the bottom-edge replaced baseline
          // (T2) instead of the *0.8 content baseline used by text-bearing
          // inline-blocks (footnote markers, cross-refs).
          { embedType: item.embedType, replacedInline: true },
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
    out.push(createTextBox(inlineRenderKey(blockId, 0), {}, ""));
  }

  return out;
}

/**
 * Change-tracking slice 5a: resolve the suggestion VISUALS for a text run and
 * return the final per-run style. When the run carries NO suggestion-id
 * dimension this returns `baseStyle` UNCHANGED (same reference) — the no-op fast
 * path keeps plain runs byte-identical to a no-suggestion render. Otherwise it
 * layers the suggestion overrides ON TOP of the normal cascaded `baseStyle`
 * (design §5):
 *   - **insertion** → author color + `underline`.
 *   - **deletion** → author color + `lineThrough` (still laid out, struck).
 *   - **formatting** → the record's `proposedAttrs` composited over the base
 *     (the proposal PREVIEW — shown but not yet applied for real) PLUS a subtle
 *     author-color `underline` indicator.
 *   - a run carrying MULTIPLE dimensions gets all of them (e.g. nested
 *     insertion+deletion → color + underline + lineThrough).
 *
 * Author color comes from {@link authorColorOf} (stable per author). The record
 * is read from the `suggestions` map by id ({@link readSuggestionRecordFromState});
 * an id with no record (collab race / migration) contributes nothing.
 *
 * `proposedAttrs` are translated through the SAME `attrRegistry.applyAll` an
 * inline run's own attrs go through (mirroring the established compose path —
 * not an ad-hoc style translation), with the run's containing-block specified
 * style as parent context, so the preview matches what `accept` will make real.
 */
function resolveSuggestionStyle(
  attrs: ReadonlyAttrs,
  baseStyle: Partial<Style>,
  state: State,
  attrRegistry: AttrRegistry,
  blockSpecified: Partial<Style>,
  view: SuggestionView,
): Partial<Style> {
  const insertionId = attrs[INSERTION_SUGGESTION_ATTR];
  const deletionId = attrs[DELETION_SUGGESTION_ATTR];
  const formattingId = attrs[FORMATTING_SUGGESTION_ATTR];
  // Fast path: not a tracked run → no override, return the base unchanged so a
  // plain run is identical to a no-suggestion render.
  if (
    typeof insertionId !== "string" &&
    typeof deletionId !== "string" &&
    typeof formattingId !== "string"
  ) {
    return baseStyle;
  }

  // 5c-iii preview views: the run already SURVIVED `itemVisibleInView`, so it is
  // rendered as it would read once resolved — with NO suggestion decoration
  // (no author color / underline / lineThrough). A `"final"` view applies a
  // formatting proposal FOR REAL (`proposedAttrs` composited over the base);
  // `"original"` drops the proposal (keeps the live attrs already in `baseStyle`).
  if (view !== "suggesting") {
    if (view === "final") {
      const fmtRecord =
        typeof formattingId === "string"
          ? readSuggestionRecordFromState(state, formattingId as SuggestionId)
          : null;
      if (fmtRecord?.proposedAttrs !== undefined) {
        const proposedStyle = attrRegistry.applyAll(fmtRecord.proposedAttrs, {
          parentStyle: blockSpecified,
        });
        return { ...baseStyle, ...proposedStyle };
      }
    }
    return baseStyle;
  }

  // Compose order: start from the base (the run's normal cascaded style), then
  // the formatting PROPOSAL preview (so it can be visibly overridden by the
  // author-color indicator below), then the author-color + decoration overrides
  // LAST (they are the suggestion's defining visual, not overridable by the
  // proposal).
  let result: Partial<Style> = { ...baseStyle };

  // Read the formatting record ONCE — it serves both the proposal preview AND (as
  // the lowest-precedence fallback) the author tint, so the formatting dimension
  // never triggers a second Y.Doc lookup on the per-keystroke render hot path.
  const formattingRecord =
    typeof formattingId === "string"
      ? readSuggestionRecordFromState(state, formattingId as SuggestionId)
      : null;

  // Formatting proposal: composite the proposed attrs over the base as the
  // preview, translated through the attr registry exactly like inline run attrs.
  if (formattingRecord?.proposedAttrs !== undefined) {
    const proposedStyle = attrRegistry.applyAll(formattingRecord.proposedAttrs, {
      parentStyle: blockSpecified,
    });
    result = { ...result, ...proposedStyle };
  }

  // Author color is shared across the run's dimensions (a run is typically all
  // one author per dimension; when both an insertion and a deletion id are
  // present we prefer the insertion author for the single tint, falling back to
  // deletion then formatting). The decoration flags accumulate across whichever
  // dimensions are present. The suggestion overrides compose LAST so they are
  // the run's defining visual (not overridable by the proposal preview).
  const authorColor = resolveRunAuthorColor(state, insertionId, deletionId, formattingRecord);
  // Insertion → underline; formatting → the same subtle author-color underline
  // indicator. Deletion → lineThrough. A nested run accumulates all flags.
  const wantUnderline = typeof insertionId === "string" || typeof formattingId === "string";
  const wantLineThrough = typeof deletionId === "string";
  result = {
    ...result,
    ...(authorColor !== null ? { color: authorColor } : {}),
    ...(wantUnderline ? { underline: true } : {}),
    ...(wantLineThrough ? { lineThrough: true } : {}),
  };

  return result;
}

/**
 * Resolve the single author color to tint a tracked run, reading the owning
 * record for whichever dimension is present. Prefers the insertion author, then
 * deletion, then formatting (a run is normally a single author per dimension;
 * the preference only matters for a nested insertion+deletion by two different
 * authors, where one tint must be chosen). Returns `null` when no present id
 * resolves to a record (collab race / migration), so the caller leaves `color`
 * to the normal cascade.
 */
function resolveRunAuthorColor(
  state: State,
  insertionId: unknown,
  deletionId: unknown,
  formattingRecord: SuggestionRecord | null,
): string | null {
  // Preference insertion → deletion → formatting (matters only for a nested
  // insertion+deletion by two authors, where one tint must be chosen). Insertion
  // and deletion read their own records; formatting reuses the record the caller
  // already read (no second Y.Doc lookup).
  for (const id of [insertionId, deletionId]) {
    if (typeof id !== "string") continue;
    const record = readSuggestionRecordFromState(state, id as SuggestionId);
    if (record !== null) return authorColorOf(record.author);
  }
  if (formattingRecord !== null) return authorColorOf(formattingRecord.author);
  return null;
}
