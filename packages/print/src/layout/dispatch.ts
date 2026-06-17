import type { RenderNode, ElementBox } from "@taleweaver/core";
import type { LayoutBox } from "./layout-box";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import type { BlockId } from "@taleweaver/core";
import { isTextShaper, measurerToShaper } from "@taleweaver/core";
import { layoutBlock } from "./bfc";
import { layoutTable } from "./table-fc";
import { cascadePass } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { markStart, markEnd } from "@taleweaver/core";
import { paginateRoot } from "./paginate";
import { paginationFallsBackToLegacy } from "./measure-pass";
import { buildVirtualPaginatedTree } from "./virtual-producer";
import type { VirtualLayoutTree } from "./virtual-layout-tree";
import { EMPTY_FOOTNOTE_ANCHORS, type FootnoteAnchorRef } from "@taleweaver/core";
import type { BlockParentLookup } from "./page-of-field-target";

/** Empty cascaded-template-body map default (no header/footer bodies). */
const EMPTY_TEMPLATE_CONTENTS: ReadonlyMap<BlockId, ElementBox> = new Map();
/** Empty cascaded-footnote-body map default (no footnote bodies). */
const EMPTY_EMBED_CONTENTS: ReadonlyMap<BlockId, ElementBox> = new Map();

/**
 * Top-level layout entry. Dispatches by display value of the root node.
 * For Plan 1, only `display: block` is supported at the root.
 * If the render tree has not had cascade applied, runs it automatically.
 *
 * Accepts either a `TextShaper` (preferred) or a legacy `TextMeasurer`
 * (backward-compat: adapted to a shaper internally).
 */
export function layoutTree(
  root: RenderNode,
  containerInlineSize: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
  // C.2c + #328: cascaded header/footer template bodies. The full-build /
  // RESIZE path must thread these (NOT default to empty) so a tall-header doc
  // re-paginates with the GROWN insets — otherwise a window resize would
  // re-lay the body as if the header fit the margin (body jumps up, header
  // re-clipped). Defaults to an empty map for the many non-editor callers
  // (tests, table-root paths) that have no header/footer bodies.
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = EMPTY_TEMPLATE_CONTENTS,
  // FN-4.0: cascaded footnote bodies + ordered footnote anchors, threaded
  // end-to-end for the footnote layout pass (FN-4.2 `resolveFootnotes`). UNUSED
  // for layout output in this plumbing task; the editor full-build path
  // (`createInitialEditorState`) populates them. Defaults keep every other
  // caller (tests, resize) byte-identical.
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox> = EMPTY_EMBED_CONTENTS,
  footnoteAnchors: readonly FootnoteAnchorRef[] = EMPTY_FOOTNOTE_ANCHORS,
  parentOf?: BlockParentLookup,
  // Auto-hyphenation (slice 2): injected `Hyphenator`, threaded ALONGSIDE the
  // shaper to every layout site. Optional trailing so the many non-editor callers
  // (tests, table roots) stay valid; the editor full-build / resize callers pass
  // `config.hyphenator`. `undefined` ⇒ no hyphenation. Carried but UNUSED in this
  // slice (the producer is slice 4).
  hyphenator?: Hyphenator,
): LayoutBox | VirtualLayoutTree {
  const t = markStart("layoutTree");
  try {
    if (root.type !== "element") {
      throw new Error("Layout root must be an element node");
    }

    const shaper: TextShaper = isTextShaper(shaperOrMeasurer)
      ? shaperOrMeasurer
      : measurerToShaper(shaperOrMeasurer);

    // Auto-run cascade if computedStyle is not populated
    const layoutRoot: ElementBox = root.computedStyle
      ? root
      : (cascadePass(root) as ElementBox);

    const cs = layoutRoot.computedStyle ?? INITIAL_COMPUTED_STYLE;
    const ctx = makeRootContext(cs, containerInlineSize);

    let result: LayoutBox | VirtualLayoutTree;

    if (pageConfig !== undefined) {
      // Paginated mode: paginateRoot drives layoutBlock per page and assembles
      // the PageBox sequence. Only display:block roots are supported in P1.B.
      // display:table roots with pageConfig are not yet handled — fall through
      // to unpaginated table layout (acceptable for P1.B scope; table-as-root
      // with pagination is unusual in real documents).
      if (cs.display === "block") {
        // Virtual mode unless the document uses a feature the measure pass
        // can't reproduce — `position:absolute`, or a float doc that is ALSO
        // multi-column or footnote-bearing (single-column float/`clear` docs now
        // take the virtualized fast path) — in which case fall back to the legacy
        // positioned page tree. This is the full (non-incremental) build — e.g.
        // the resize path — so there is no carry-forward memo.
        result = paginationFallsBackToLegacy(layoutRoot, footnoteAnchors)
          ? paginateRoot(layoutRoot, ctx, shaper, hyphenator, pageConfig)
          : buildVirtualPaginatedTree(
              layoutRoot, ctx, shaper, pageConfig, undefined,
              cascadedTemplateContents, cascadedEmbedContents, footnoteAnchors,
              parentOf, hyphenator,
            );
      } else {
        // Non-block root with pagination: layout without pagination for now.
        if (cs.display === "table") {
          const tableResult = layoutTable(layoutRoot, 0, 0, ctx, shaper, hyphenator);
          if (tableResult.box === null) {
            throw new Error("layoutTable at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = tableResult.box;
        } else {
          throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
        }
      }
    } else {
      switch (cs.display) {
        case "block": {
          const blockResult = layoutBlock(layoutRoot, 0, 0, ctx, shaper, hyphenator);
          if (blockResult.box === null) {
            throw new Error("layoutBlock at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = blockResult.box;
          break;
        }
        case "table": {
          const tableResult = layoutTable(layoutRoot, 0, 0, ctx, shaper, hyphenator);
          if (tableResult.box === null) {
            throw new Error("layoutTable at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = tableResult.box;
          break;
        }
        default:
          throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
      }
    }

    return result;
  } finally {
    markEnd("layoutTree", t);
  }
}
