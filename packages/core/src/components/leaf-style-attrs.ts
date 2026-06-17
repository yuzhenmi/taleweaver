import type { TextAlign } from "../cascade/builtin-attrs";
import { isTextAlign, normalizeTabStops } from "../cascade/builtin-attrs";
import type { WritingMode, TabStop, Float, Direction } from "../styles";

const VALID_WRITING_MODES: ReadonlySet<WritingMode> = new Set<WritingMode>([
  "horizontal-tb",
  "vertical-rl",
  "vertical-lr",
]);

/**
 * Type guard for the CSS `writing-mode` keywords this engine supports
 * (`"horizontal-tb" | "vertical-rl" | "vertical-lr"` — the `WritingMode`
 * union in `styles/writing-mode.ts`). Physical-flow-only keywords
 * (`sideways-rl`/`sideways-lr`) are out of scope and rejected.
 */
export function isWritingMode(value: unknown): value is WritingMode {
  return typeof value === "string" && VALID_WRITING_MODES.has(value as WritingMode);
}

/**
 * Read a block-level `writingMode` attr override for a block component
 * (document / paragraph / heading / list-item).
 *
 * Per the components/builtin-attrs "component-set" convention (see
 * `textAlignFromAttrs` above and `cascade/builtin-attrs.ts`), block-level
 * structural style that must reach layout is synthesized by the component onto
 * its ElementBox `style`: the layout cascade re-derives `computedStyle` from
 * `node.style`, and the render-time attrs-derived `view.computedStyle` is not
 * threaded onto the ElementBox style, so a generic cascade interpreter alone
 * never reaches layout for this property. `writingMode` is an inherited property
 * (`property-meta.ts`), so declaring it once on the document root cascades to
 * all descendant blocks; a per-block override sets it on that block's leaf.
 *
 * Returns the validated keyword, or `undefined` to leave the property unset so
 * the layout cascade falls back to inheritance / the initial `"horizontal-tb"`.
 */
export function writingModeFromAttrs(value: unknown): WritingMode | undefined {
  return isWritingMode(value) ? value : undefined;
}

/**
 * Read a block-level `lang` attr override for a block component
 * (document / paragraph / heading / list-item) and synthesize it onto the
 * ElementBox `style` as the `language` property.
 *
 * Per the components/builtin-attrs "component-set" convention (see
 * `writingModeFromAttrs` above), block-level style that must reach layout is
 * synthesized by the component onto its ElementBox `style`: the layout cascade
 * re-derives `computedStyle` from `node.style`, and the render-time attrs-derived
 * `view.computedStyle` is not threaded onto the ElementBox style, so the
 * `langInterpreter` (a generic cascade interpreter) alone never reaches layout.
 * `language` is an inherited property (`property-meta.ts`), so declaring it once
 * on the document root cascades to every descendant block — which is what feeds
 * the PDF `/Lang` catalog entry (the controller's `firstBodyLanguage` walk reads
 * `text-run.computedStyle.language`) and per-block auto-hyphenation (`ifc.ts`
 * reads `cs.language`).
 *
 * The value is taken verbatim (no BCP-47 normalization — matching the
 * `langInterpreter`). An EMPTY string returns `undefined` (NOT `""`): leaving
 * the property unset lets the layout cascade fall back to inheritance / the
 * initial `""`, whereas synthesizing `language: ""` on a child would CLOBBER an
 * inherited document language. This mirrors how every other `*FromAttrs` helper
 * drops invalid/empty input to preserve inheritance.
 *
 * Returns the validated tag, or `undefined` to leave the property unset.
 */
export function langFromAttrs(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Read a block-level `textAlign` attr override for an inline-bearing-leaf
 * component (paragraph / heading / list-item).
 *
 * Per the components/builtin-attrs "component-set" convention (see
 * `cascade/builtin-attrs.ts` and `components/paragraph.ts`), block-level
 * structural style that must reach layout is synthesized by the component
 * onto its ElementBox `style`: the layout cascade re-derives `computedStyle`
 * from `node.style`, and the render-time attrs-derived `view.computedStyle`
 * is not threaded onto the ElementBox style, so a generic cascade
 * interpreter alone never reaches layout for this property.
 *
 * Reuses the shared `isTextAlign` guard so the validation matches the
 * `textAlignInterpreter`'s exactly (logical keywords only — physical
 * `"left"`/`"right"` are rejected; the layout pass maps logical → physical
 * via writing-mode).
 *
 * Returns the validated keyword, or `undefined` to leave the property unset
 * so the layout cascade falls back to inheritance / the initial `"start"`.
 */
export function textAlignFromAttrs(value: unknown): TextAlign | undefined {
  return isTextAlign(value) ? value : undefined;
}

/**
 * Read a block-level `lineHeight` (line-spacing) attr override for an
 * inline-bearing-leaf component (paragraph / heading / list-item). The value
 * is the Google-Docs line-spacing MULTIPLIER — a unitless ratio of the
 * element's own font size (1.0 / 1.15 / 1.5 / 2.0).
 *
 * Per the same component-set convention as `textAlignFromAttrs` above:
 * line-spacing must reach the layout cascade (the IFC derives each line box's
 * block size from the used line-height), but the render-time attrs-derived
 * `view.computedStyle` is not threaded onto the ElementBox style, so the
 * component synthesizes `lineHeight` onto `node.style`. The layout cascade's
 * `used-style` then resolves the unitless ratio to px (`ratio × fontSize`),
 * inheriting as a ratio so nested runs scale with their own font size.
 *
 * Only the unitless `number` form is accepted here (the line-spacing control's
 * vocabulary). Structured-Length forms (`em`/`percent`) still flow through the
 * generic `lineHeightInterpreter` for non-component authoring paths; this
 * component path covers the editor's `SET_LINE_SPACING` action. Returns the
 * ratio, or `undefined` to leave the property unset so it inherits / falls back
 * to the initial ratio.
 */
export function lineHeightFromAttrs(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

/**
 * Read a block-level `marginInlineStart` (indent) attr override for an
 * inline-bearing-leaf component (paragraph / heading / list-item). The value
 * is the indent in px — Google Docs' increase/decrease-indent control steps it
 * by `INDENT_STEP` (see `editor/actions/indent.ts`).
 *
 * Per the same component-set convention as `textAlignFromAttrs` /
 * `lineHeightFromAttrs` above: the indent must reach the layout cascade (the
 * BFC insets the in-flow block by its `marginInlineStart` and narrows its
 * content width), but the render-time attrs-derived `view.computedStyle` is not
 * threaded onto the ElementBox style, so the component synthesizes
 * `marginInlineStart` onto `node.style`.
 *
 * Only a finite `number > 0` is accepted (a bare number is a valid px Length).
 * Non-number / non-finite / `<= 0` garbage → `undefined`, leaving the property
 * unset so the block sits at its container's content edge (no indent). Mirrors
 * `lineHeightFromAttrs` exactly. The editor's `INDENT`/`OUTDENT` actions clear
 * the attr on outdent-to-0, so an un-indented block never carries it.
 */
export function marginInlineStartFromAttrs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read a block-level `marginBlockStart` (Google Docs "space before paragraph")
 * attr override for an inline-bearing-leaf component (paragraph / heading /
 * list-item). The value is the space in px — the editor's
 * `SET_PARAGRAPH_SPACING` action (edge `"before"`) sets it.
 *
 * Per the same component-set convention as `marginInlineStartFromAttrs` above:
 * the spacing must reach the layout cascade (the BFC applies in-flow blocks'
 * `marginBlockStart`/`End` with CSS margin collapsing), but the render-time
 * attrs-derived `view.computedStyle` is not threaded onto the ElementBox style,
 * so the component synthesizes `marginBlockStart` onto `node.style`.
 *
 * Accepts a finite `number >= 0` — UNLIKE the indent path (`> 0`), `0` is a
 * VALID value here: a user may explicitly set "0 space before" to OVERRIDE a
 * component's default em margin (e.g. heading's 0.67em). When the attr is
 * absent (`undefined`), this returns `undefined` and the component keeps its
 * default em margin unchanged — existing docs render byte-identically.
 * Non-number / non-finite / negative garbage → `undefined`, leaving the
 * default in place. Mirrors `marginBlockEndFromAttrs`.
 */
export function marginBlockStartFromAttrs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Read a block-level `marginBlockEnd` (Google Docs "space after paragraph")
 * attr override for an inline-bearing-leaf component (paragraph / heading /
 * list-item). The value is the space in px — the editor's
 * `SET_PARAGRAPH_SPACING` action (edge `"after"`) sets it.
 *
 * Identical contract to `marginBlockStartFromAttrs` (the other edge): accepts a
 * finite `number >= 0` so `0` can explicitly override a component default (e.g.
 * paragraph's 0.5em `marginBlockEnd`); `undefined`/garbage → `undefined`,
 * leaving the component's default em margin in place (byte-identical render).
 */
export function marginBlockEndFromAttrs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Read a block-level `tabStops` (per-paragraph tab-stop list) attr override for
 * an inline-bearing-leaf component (paragraph / heading / list-item).
 *
 * Per the same component-set convention as `textAlignFromAttrs` /
 * `marginInlineStartFromAttrs` above: the stop list must reach the layout
 * cascade — the IFC resolves each tab's destination stop from the paragraph's
 * `tabStops` at wrap time — but the render-time attrs-derived
 * `view.computedStyle` is not threaded onto the ElementBox style, so the
 * component synthesizes `tabStops` onto `node.style`. Reuses the shared
 * `normalizeTabStops` so the validation/sort matches the `tabStopsInterpreter`
 * exactly (clamp `position >= 0`, default `alignment`/`leader`, sort ascending).
 *
 * `tabStops` is a NON-inherited property (`property-meta.ts`) — each paragraph
 * carries its own stops, so an absent attr leaves the property unset and the
 * layout cascade falls back to the initial empty list (the default grid).
 * Returns the normalized array, or `undefined` for a non-array / absent attr.
 */
export function tabStopsFromAttrs(value: unknown): readonly TabStop[] | undefined {
  const stops = normalizeTabStops(value);
  return stops !== null ? stops : undefined;
}

/**
 * Map the Google-Docs PHYSICAL image-wrap enum (`"left" | "right" | "break"`) to
 * the engine's LOGICAL `Float`, resolved against the image block's writing
 * `direction`. Google Docs' "wrap left" means PHYSICAL left; the engine's
 * `float` is logical (`inline-start`/`inline-end`, mapped to a physical side by
 * `float-context.ts` against the container direction). So under RTL "left" must
 * resolve to `inline-end` (and "right" to `inline-start`) to stay physically
 * placed where the user asked. `"break"` / unknown → `undefined`: leave `float`
 * unset so the image keeps its full-width `display:block` default (the current,
 * unchanged behavior). Mirrors the component-set convention of `textAlignFromAttrs`.
 *
 * Physical-side trace (sign-correctness, verified against `float-context.ts` +
 * `writing-mode.ts` `logicalToPhysical`): under RTL, `inline-end` resolves to
 * physical `x=0` (left) — `inlineOffset = containingInlineSize − inlineSize`, then
 * `logicalToPhysical` RTL mirror `x = containingInlineSize − inlineOffset −
 * inlineSize = 0`. So `wrap:"left"` → `inline-end` (RTL) → physically left, as
 * intended. The inversion direction is correct (no sign error).
 */
export function imageWrapFloat(wrap: unknown, direction: Direction): Float | undefined {
  if (wrap === "left") return direction === "rtl" ? "inline-end" : "inline-start";
  if (wrap === "right") return direction === "rtl" ? "inline-start" : "inline-end";
  return undefined; // "break" + any unrecognized value
}
