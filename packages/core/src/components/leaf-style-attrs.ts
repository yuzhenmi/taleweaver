import type { TextAlign } from "../cascade/builtin-attrs";
import { isTextAlign } from "../cascade/builtin-attrs";

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
