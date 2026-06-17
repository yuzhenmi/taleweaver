import type { LeafComponentDefinition } from "./component-definition";
import type { Style } from "../styles";
import { createElementBox } from "../render/render-node";
import { formatCounter } from "../styles/format-counter";
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

/**
 * List-item: an inline-bearing leaf block — the FLAT Google-Docs list model.
 *
 * In the word-processor model (Word / Google Docs), list membership is a
 * per-paragraph property: a paragraph carries a `listId` (which list it belongs
 * to) and a `listLevel` (its nesting depth), NOT a wrapping container element or
 * a per-item `list-style-type`. The marker (a bullet glyph or a number like
 * "1.") is COMPUTED at render time from the document's numbering state — the
 * same number that appears would change if list items are inserted/reordered —
 * not stored on the item. This component therefore:
 *
 *   - derives the structural indent (the marker gutter / list indent) from
 *     `listLevel`: BASE_LIST_INDENT at level 0, growing by LEVEL_STEP per level
 *     so deeper items indent further (Google-Docs nested-list indentation);
 *   - derives the marker string from a render-time numbering service via
 *     `ctx.counterValue(listId, blockId)`, baking the result into `markerText`
 *     on the ElementBox `style`. The BFC reads `childCs.markerText` and emits a
 *     GENERATED marker sibling box (offset-excluded — zero cursor stops). A
 *     numbered marker (decimal/alpha/roman) gets a trailing "." appended; a
 *     bullet glyph (disc/circle/square) is rendered as-is.
 *
 * `markerText` is set ONLY when `counterValue` resolves: before the render
 * wiring supplies the numbering service (and for the legacy stub RenderContexts
 * that omit `counterValue`), the item renders with no marker rather than a
 * stale glyph.
 *
 * Block-level structural style that must reach the layout cascade
 * (writingMode / textAlign / lineHeight / marginInlineStart / paragraph
 * spacing) is forwarded from attrs onto the ElementBox `style` per the
 * components/builtin-attrs "component-set" convention (see `leaf-style-attrs.ts`
 * and `paragraph.ts`): the layout cascade re-derives `computedStyle` from
 * `node.style`, so the component must synthesize these onto the style.
 *
 * The user's `marginInlineStart` (INDENT/OUTDENT) composes ON TOP OF the
 * structural padding — the BFC adds them (`childInlineStart =
 * paddingInlineStart + marginInlineStart`) — so indenting a list item increases
 * its indent past the base list indent.
 *
 * DESIGN RATIONALE (#418): a list-item intentionally has ZERO default block
 * margins — UNLIKE the paragraph component, which defaults `marginBlockEnd:
 * 0.5em` for inter-paragraph spacing. Consecutive list items therefore pack
 * tightly into a cohesive list, matching the Google-Docs / word-processor
 * convention. (WITHIN-item line spacing is unchanged: both inherit the same
 * default lineHeight.) Locked by a regression test in list-item.test.ts.
 */

/**
 * Structural list indent (the marker gutter) at nesting level 0. Each deeper
 * level adds LEVEL_STEP, indenting nested list items further.
 */
const BASE_LIST_INDENT = 30;
const LEVEL_STEP = 30;

/**
 * The exact glyphs `formatCounter` emits for the bullet styles — used to decide
 * "bullet (render the glyph as-is)" vs "number (append a trailing '.')". Built
 * from `formatCounter` at module init (it is a pure, side-effect-free leaf
 * function) so the set stays in lock-step with the formatter rather than
 * sniffing strings. Current glyphs: disc "•" (U+2022), circle "○" (U+25CB),
 * square "▪" (U+25AA).
 */
const BULLET_GLYPHS: ReadonlySet<string> = new Set([
  formatCounter(1, "disc"),
  formatCounter(1, "circle"),
  formatCounter(1, "square"),
]);

export const listItemComponent: LeafComponentDefinition = {
  type: "list-item",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, ctx, inlineRenderNodes) => {
    const levelRaw = view.attrs.listLevel;
    const level = typeof levelRaw === "number" && Number.isFinite(levelRaw) && levelRaw > 0
      ? Math.floor(levelRaw)
      : 0;
    const listIdRaw = view.attrs.listId;
    const listId = typeof listIdRaw === "string" ? listIdRaw : "";

    const counter = ctx.counterValue?.(listId, view.id);
    let markerText: string | undefined;
    let ordered: boolean | undefined;
    if (counter !== undefined) {
      const isBullet = BULLET_GLYPHS.has(counter.formatted);
      markerText = isBullet ? counter.formatted : `${counter.formatted}.`;
      ordered = !isBullet;
    }

    const writingMode = writingModeFromAttrs(view.attrs.writingMode);
    const language = langFromAttrs(view.attrs.lang);
    const textAlign = textAlignFromAttrs(view.attrs.textAlign);
    const lineHeight = lineHeightFromAttrs(view.attrs.lineHeight);
    const marginInlineStart = marginInlineStartFromAttrs(view.attrs.marginInlineStart);
    const marginBlockStart = marginBlockStartFromAttrs(view.attrs.marginBlockStart);
    const marginBlockEnd = marginBlockEndFromAttrs(view.attrs.marginBlockEnd);
    const tabStops = tabStopsFromAttrs(view.attrs.tabStops);

    const style: Style = {
      display: "list-item",
      // Structural marker gutter / list indent — always present, grows per
      // nesting level so the marker lands at a positive inline offset inside
      // the content column.
      paddingInlineStart: BASE_LIST_INDENT + level * LEVEL_STEP,
      // Render-baked marker (bullet glyph or "<n>."). Omitted when the
      // numbering service did not resolve a value for this item.
      ...(markerText !== undefined ? { markerText } : {}),
      ...(writingMode !== undefined ? { writingMode } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(textAlign !== undefined ? { textAlign } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      ...(tabStops !== undefined ? { tabStops } : {}),
      // User indent (INDENT/OUTDENT) composes ON TOP OF the structural padding.
      ...(marginInlineStart !== undefined ? { marginInlineStart } : {}),
      // Paragraph-spacing attrs (space-before/after). Default is ZERO block
      // margins (#418) — only authored values appear here.
      ...(marginBlockStart !== undefined ? { marginBlockStart } : {}),
      ...(marginBlockEnd !== undefined ? { marginBlockEnd } : {}),
    };
    return createElementBox(
      view.id,
      style,
      inlineRenderNodes,
      ordered !== undefined ? { list: { level, listId, ordered } } : undefined,
    );
  },
};
