import type { BlockId } from "../state";
import { CROSS_REFERENCE_EMBED_TYPE, TAB_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS } from "../state";
import type { OutlineEntry } from "../state/outline";
import type { Style } from "../styles";
import type { TocAttrs } from "../components/table-of-contents-attrs";
import type { ElementBox, RenderNode } from "./render-node";
import { createElementBox, createTextBox } from "./render-node";

/**
 * Build the entry-line render subtree for a live Table of Contents.
 *
 * A live TOC's entry lines (heading text … leader … page number) are NEVER
 * stored in state — they are DERIVED at render time from the document outline
 * (Google Docs' "live" TOC; the alternative "snapshot" TOC is not what this
 * builds). This is the pure function that turns an `outline` + the TOC's
 * `attrs` into one block-level entry box per qualifying outline entry. A later
 * slice wires it into the render walk where the `tableOfContents` anchor sits.
 *
 * Each entry line is:
 *   [ heading text ][ tab → content-edge leader ][ page-number field ]
 * The page-number field is a `"page"`-mode cross-reference ATOM (one IFC token =
 * one cursor stop) whose real value is bound LATE at materialize — exactly the
 * shipped cross-ref-page seam (`collectPageFields` derives the host block from
 * the `/toc/<i>` key segment). When `attrs.showPageNumbers` is false the line is
 * just the heading text (no tab, no page field).
 *
 * Only entries whose `level` is in `attrs.levels` are emitted; the running index
 * `i` is over the FILTERED entries, so keys stay dense (`0, 1, 2, …`).
 */
export function buildTocEntrySubtree(
  outline: readonly OutlineEntry[],
  attrs: TocAttrs,
  tocId: BlockId,
): ElementBox[] {
  const levels = new Set(attrs.levels);
  const boxes: ElementBox[] = [];

  let i = 0;
  for (const { blockId: headingId, level, text } of outline) {
    if (!levels.has(level)) continue;

    const entryKey = `${tocId}/entry/${i}`;

    const textRun = createTextBox(`${entryKey}/text`, {}, text);

    // The entry-line block style: indent by level, and (when page numbers show)
    // a single content-edge tab stop so the leader + page number align to the
    // page's content edge (the `"content-edge"` tab alignment shipped earlier).
    const style: Style = {
      display: "block",
      marginInlineStart: (level - 1) * attrs.indentStep,
      ...(attrs.showPageNumbers
        ? { tabStops: [{ position: 0, alignment: "content-edge", leader: attrs.leader }] }
        : {}),
    };

    const children: RenderNode[] = attrs.showPageNumbers
      ? [textRun, buildTabBox(entryKey), buildPageAtom(tocId, i, headingId)]
      : [textRun];

    // Metadata rides on the WHOLE block box (not the page atom): this makes the
    // entire entry line the click-nav target, so a click anywhere on the line
    // jumps to the heading (Google-Docs behavior). The DOM controller's TOC
    // hit-test walks up to this `tocEntry`-tagged box. This is a deliberate
    // refinement of the spec's "marker on the atom" wording.
    boxes.push(
      createElementBox(entryKey, style, children, { tocEntry: true, navTarget: headingId }),
    );

    i++;
  }

  return boxes;
}

/**
 * The inter-text tab box. The IFC recognizes a tab by `embedType === "tab"`;
 * `inlineSize: 0` lets the tab-stop logic expand it to the content edge.
 */
function buildTabBox(entryKey: string): ElementBox {
  return createElementBox(
    `${entryKey}/tab`,
    { display: "inline-block", inlineSize: 0 },
    [],
    { embedType: TAB_EMBED_TYPE },
  );
}

/**
 * The page-number field — a `"page"`-mode cross-reference atom. The `/toc/<i>`
 * key segment is what the shipped `collectPageFields` recognizes to derive the
 * host block (`hostBlockId = tocId`); exactly ONE placeholder text child is the
 * field-substitution contract (the real page number replaces it at materialize).
 * `numberStyle` is `"decimal"` (TocAttrs exposes no number-style option).
 */
function buildPageAtom(tocId: BlockId, i: number, headingId: BlockId): ElementBox {
  const atomKey = `${tocId}/toc/${i}`;
  return createElementBox(
    atomKey,
    { display: "inline-block" },
    [createTextBox(`${atomKey}/0`, {}, "0".repeat(PAGE_FIELD_RESERVED_GLYPHS))],
    {
      embedType: CROSS_REFERENCE_EMBED_TYPE,
      refMode: "page",
      targetId: headingId,
      numberStyle: "decimal",
    },
  );
}
