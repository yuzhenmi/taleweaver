import type { LeafComponentDefinition } from "./component-definition";
import type { Style, WhiteSpace } from "../styles";
import { createElementBox } from "../render/render-node";
import {
  textAlignFromAttrs,
  lineHeightFromAttrs,
  marginInlineStartFromAttrs,
  marginBlockStartFromAttrs,
  marginBlockEndFromAttrs,
  writingModeFromAttrs,
  langFromAttrs,
  tabStopsFromAttrs,
} from "./leaf-style-attrs";

const VALID_WHITE_SPACES: ReadonlySet<WhiteSpace> = new Set<WhiteSpace>([
  "normal",
  "nowrap",
  "pre",
  "pre-wrap",
  "pre-line",
  "break-spaces",
]);

/**
 * Read a `whiteSpace` attr override. Per the component-set convention
 * (see `cascade/builtin-attrs.ts`), block-level structural style that
 * must reach layout is synthesized by the component onto its ElementBox
 * `style` — the layout pass cascades from `node.style`, and the
 * render-time attrs-derived `view.computedStyle` is not threaded into the
 * ElementBox style, so a generic cascade interpreter would not reach
 * layout for a block-level property.
 *
 * Returns the validated `WhiteSpace`, or `undefined` to leave the property
 * unset so it inherits the cascaded value (the document root's `break-spaces`,
 * see `components/document.ts`).
 */
function whiteSpaceFromAttrs(value: unknown): WhiteSpace | undefined {
  return typeof value === "string" && VALID_WHITE_SPACES.has(value as WhiteSpace)
    ? (value as WhiteSpace)
    : undefined;
}

/**
 * Paragraph: a leaf block whose `inlineContent` carries text runs and
 * inline embeds. The renderer expands those items into TextBox /
 * ElementBox children before calling `render`; the component just wraps
 * them in a block-level ElementBox.
 *
 * Default structural style: `display: block` + `marginBlockEnd: 0.5em`
 * for inter-paragraph spacing. An authored `whiteSpace` attr overrides the
 * inherited document default (`break-spaces`) — e.g. `"normal"` to collapse,
 * or `"pre"` for a code-style block — baked onto the ElementBox `style` so it
 * reaches the layout cascade. Authored `textAlign` and `writingMode` attrs are
 * forwarded the same way (see `leaf-style-attrs.ts`).
 */
export const paragraphComponent: LeafComponentDefinition = {
  type: "paragraph",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineRenderNodes) => {
    const whiteSpace = whiteSpaceFromAttrs(view.attrs.whiteSpace);
    const writingMode = writingModeFromAttrs(view.attrs.writingMode);
    const language = langFromAttrs(view.attrs.lang);
    const textAlign = textAlignFromAttrs(view.attrs.textAlign);
    const lineHeight = lineHeightFromAttrs(view.attrs.lineHeight);
    const marginInlineStart = marginInlineStartFromAttrs(view.attrs.marginInlineStart);
    const marginBlockStart = marginBlockStartFromAttrs(view.attrs.marginBlockStart);
    const marginBlockEnd = marginBlockEndFromAttrs(view.attrs.marginBlockEnd);
    const tabStops = tabStopsFromAttrs(view.attrs.tabStops);
    const style: Style = {
      display: "block",
      marginBlockEnd: { unit: "em", value: 0.5 },
      ...(whiteSpace !== undefined ? { whiteSpace } : {}),
      ...(writingMode !== undefined ? { writingMode } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(textAlign !== undefined ? { textAlign } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      ...(tabStops !== undefined ? { tabStops } : {}),
      ...(marginInlineStart !== undefined ? { marginInlineStart } : {}),
      // Paragraph-spacing attrs WIN over the component's default em margins
      // (the 0.5em `marginBlockEnd` above) — they're spread last so the attr
      // value overrides. Absent attr → undefined → default unchanged.
      ...(marginBlockStart !== undefined ? { marginBlockStart } : {}),
      ...(marginBlockEnd !== undefined ? { marginBlockEnd } : {}),
    };
    return createElementBox(view.id, style, inlineRenderNodes);
  },
};
