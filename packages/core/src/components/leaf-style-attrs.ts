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
