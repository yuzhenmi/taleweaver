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

// One adapter per `TextMeasurer`, so a host that passes a measurer (rather than a
// `TextShaper`) hands layout a REF-STABLE shaper on every cycle. The block-meta
// cache (`build-fit-metas`) keys on the shaper ref; a fresh adapter per call
// misses it and re-lays EVERY block on EVERY keystroke. A `WeakMap`, so dropping
// the measurer drops its adapter.
const _adaptedShapers = new WeakMap<TextMeasurer, TextShaper>();

/** The shaper for `shaperOrMeasurer`; a measurer's adapter is memoized (ref-stable). */
export function resolveShaper(shaperOrMeasurer: TextShaper | TextMeasurer): TextShaper {
  if (isTextShaper(shaperOrMeasurer)) return shaperOrMeasurer;
  let shaper = _adaptedShapers.get(shaperOrMeasurer);
  if (shaper === undefined) {
    shaper = measurerToShaper(shaperOrMeasurer);
    _adaptedShapers.set(shaperOrMeasurer, shaper);
  }
  return shaper;
}

/**
 * Top-level layout entry. Dispatches by display value of the root node.
 * Only `display: block` is supported at the root.
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
  // Cascaded header/footer template bodies (produced by the layout-driver's
  // cascade). A caller laying out a document with headers/footers must thread
  // these (NOT default to empty) so a tall header re-paginates with the grown
  // insets. Defaults to an empty map for callers that have no header/footer
  // bodies (tests, and `layoutTreeIncremental`'s unsupported-display fallback).
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = EMPTY_TEMPLATE_CONTENTS,
  // Cascaded footnote bodies + ordered footnote anchors, threaded
  // end-to-end for the footnote layout pass (`resolveFootnotes`). Defaults keep
  // callers without footnotes (tests, the incremental unsupported-display
  // fallback) byte-identical.
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox> = EMPTY_EMBED_CONTENTS,
  footnoteAnchors: readonly FootnoteAnchorRef[] = EMPTY_FOOTNOTE_ANCHORS,
  parentOf?: BlockParentLookup,
  // Auto-hyphenation: injected `Hyphenator`, threaded ALONGSIDE the
  // shaper to every layout site. Optional trailing so the many non-editor callers
  // (tests, table roots) stay valid; a hyphenating caller passes its
  // `LayoutConfig.hyphenator`. `undefined` ⇒ no hyphenation.
  hyphenator?: Hyphenator,
): LayoutBox | VirtualLayoutTree {
  const t = markStart("layoutTree");
  try {
    if (root.type !== "element") {
      throw new Error("Layout root must be an element node");
    }

    const shaper = resolveShaper(shaperOrMeasurer);

    // Auto-run cascade if computedStyle is not populated
    const layoutRoot: ElementBox = root.computedStyle
      ? root
      : (cascadePass(root) as ElementBox);

    const cs = layoutRoot.computedStyle ?? INITIAL_COMPUTED_STYLE;
    const ctx = makeRootContext(cs, containerInlineSize);

    let result: LayoutBox | VirtualLayoutTree;

    if (pageConfig !== undefined) {
      // Paginated mode: paginateRoot drives layoutBlock per page and assembles
      // the PageBox sequence. Only display:block roots are supported.
      // display:table roots with pageConfig are not yet handled — fall through
      // to unpaginated table layout (table-as-root
      // with pagination is unusual in real documents).
      if (cs.display === "block") {
        // Virtual mode unless the document uses a feature the measure pass
        // can't reproduce — `position:absolute`, or a float doc that is ALSO
        // multi-column or footnote-bearing (single-column float/`clear` docs now
        // take the virtualized fast path) — in which case fall back to the legacy
        // positioned page tree. This is the full (non-incremental) build (tests and
        // the incremental unsupported-display fallback), so there is no carry-forward memo.
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
          throw new Error(`display "${cs.display}" not yet implemented`);
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
          throw new Error(`display "${cs.display}" not yet implemented`);
      }
    }

    return result;
  } finally {
    markEnd("layoutTree", t);
  }
}
