import type { ContainerComponentDefinition } from "./component-definition";
import type { Style } from "../styles";
import { createElementBox } from "../render/render-node";
import { writingModeFromAttrs, langFromAttrs } from "./leaf-style-attrs";

/**
 * Document: the root container block. Holds child blocks (paragraphs,
 * lists, tables, etc.). The renderer pre-renders all children; this
 * component wraps them in a single block-level ElementBox.
 *
 * `whiteSpace: "break-spaces"` is the editor's body default — matching Google
 * Docs' trailing-space behavior. A word processor preserves every space the
 * user types (leading, interior runs, trailing) and wraps at WORD boundaries.
 * Trailing whitespace at a soft-wrap boundary HANGS (#338): a space unit never
 * wraps to the next line on its own (only words wrap), and a hung space is
 * CLAMPED to the line's content edge — its box geometry and the caret are
 * pinned to the edge, so no number of trailing spaces pushes a glyph or the
 * caret past the page edge. So a lone trailing space stays at the line end
 * (the next word wraps), and N trailing spaces all collapse at the edge,
 * on-page. This is an intentional, Google-Docs-matching deviation from literal
 * CSS `break-spaces` (which would wrap each space to the next line) — settled
 * by the word-processor convention over the browser convention for this
 * editing-shape question. (It also supersedes the reverted `pre-wrap` "hang",
 * which lacked the clamp and let the caret run off-page.) `whiteSpace` is an
 * inherited property (`property-meta.ts`), so declaring it once on the document
 * root cascades to all body text; the global CSS *initial* value stays
 * `normal`. Per-component overrides (e.g. a future code block that wants `pre`)
 * set their own `whiteSpace`.
 *
 * An authored `writingMode` attr on the document root is forwarded onto the
 * ElementBox `style` (component-set convention, see `leaf-style-attrs.ts`).
 * `writingMode` is an inherited property (`property-meta.ts`), so a document-
 * level `vertical-rl`/`vertical-lr` cascades to every body block AND sets the
 * page frame's writing mode (the paginator reads the cascaded root's
 * `writingMode` into the root layout context). Per-block overrides set their
 * own `writingMode` on the leaf.
 */
export const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const writingMode = writingModeFromAttrs(view.attrs.writingMode);
    const language = langFromAttrs(view.attrs.lang);
    const style: Style = {
      display: "block",
      whiteSpace: "break-spaces",
      // Google-Docs body default: a long unbreakable string (URL, hash, "aaaa…")
      // breaks to fit the page rather than running off it. Mirrors the
      // `whiteSpace: "break-spaces"` decision — principle 7 (Google Docs) over the
      // CSS `overflow-wrap: normal` initial. See overflow-wrap design spec.
      overflowWrap: "break-word",
      ...(writingMode !== undefined ? { writingMode } : {}),
      // A document-level `lang` cascades (language inherits) to every body block,
      // feeding PDF `/Lang` and per-block auto-hyphenation. See leaf-style-attrs.ts.
      ...(language !== undefined ? { language } : {}),
    };
    return createElementBox(
      view.id,
      style,
      childRenderNodes,
      // The implicit-section default header/footer body ids (C.2c). A
      // section-less document (or the leading section-less run) takes its
      // header/footer from the doc root's own attrs; `section-plan`'s
      // `buildSectionPlan` reads these off `cascadedRoot.metadata` onto the
      // implicit/leading boundary. Stamped RAW (no AttrRegistry interpreter),
      // mirroring how the section component stamps per-section ids; the plan
      // coerces them (string ⇒ BlockId, else undefined).
      {
        headerBlockId: view.attrs.headerBlockId,
        footerBlockId: view.attrs.footerBlockId,
        // Whole-doc multi-column default (Format ▸ Columns applied with no
        // section break). `buildSectionPlan` reads these off `cascadedRoot.metadata`
        // (the doc-root box IS the cascaded root) via `resolveColumnConfig` into
        // `effectiveDefaultColumns`, mirroring how the per-section component stamps
        // its own overrides and how `headerBlockId`/`footerBlockId` flow doc-wide.
        // Stamped RAW (no AttrRegistry interpreter); the plan validates them.
        columnCount: view.attrs.columnCount,
        columnGap: view.attrs.columnGap,
        columnRule: view.attrs.columnRule,
      },
    );
  },
};
