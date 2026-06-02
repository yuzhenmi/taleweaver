import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { mergeAttrs } from "../attrs";
import { getTreeMap, getYBlock } from "../yjs-doc";
import { buildYBlock, buildYAttrs } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";

/** Which page region a template body fills, and the attr key it links through. */
export type TemplateRegion = "header" | "footer";

export interface InsertTemplateBodyArgs {
  readonly region: TemplateRegion;
  /**
   * The SECTION block the body links onto. For the implicit (doc-root)
   * section this is `state.rootId`; per-section bodies pass the section's id.
   * Must resolve to a block in the MAIN tree (`kind === "block"`).
   */
  readonly sectionBlockId: BlockId;
}

/**
 * Result of `insertTemplateBody`. Extends `OperationResult` with the new
 * template body's CONTAINER ROOT id (`bodyRootId` — the id the section's
 * `headerBlockId` / `footerBlockId` links to, and the one root the slot lays
 * out) and the id of its FIRST (and only) paragraph CHILD (`firstParagraphId`
 * — the editable caret target for the create→type chain).
 */
export interface InsertTemplateBodyResult extends OperationResult {
  readonly bodyRootId: BlockId;
  readonly firstParagraphId: BlockId;
}

/** `region → section attr key`. */
const REGION_ATTR_KEY: Record<TemplateRegion, "headerBlockId" | "footerBlockId"> = {
  header: "headerBlockId",
  footer: "footerBlockId",
};

/**
 * Create a template body (a CONTAINER root holding one empty paragraph child)
 * and link it onto a section, atomically (ONE `applyOperation` transaction).
 *
 * The body is a `template-body` CONTAINER, not a single `paragraph` root,
 * because a header/footer is multi-line (Google Docs): pressing Enter splits
 * the child paragraph into two sibling paragraphs UNDER the container, and the
 * page slot (`materializePage`) — which lays out the ONE linked root's subtree
 * via its BFC — renders every line. A single `paragraph` root would split into
 * a SECOND `parentId: null` root the slot never renders (the "Enter does
 * nothing" bug, #326) and a spurious extra `getTemplateContentIds` entry.
 *
 * Writes, one transaction:
 *  1. A fresh `template-body` CONTAINER root (`parentId: null` — a tree root in
 *     templateContents, NOT a child; `inlineContent: null` — it's a container)
 *     whose `firstChildId`/`lastChildId` point at the paragraph child below.
 *     Its null `parentId` makes the #313 root-only iterator
 *     (`getTemplateContentIds`) pick up EXACTLY this one root, so the render
 *     path lays out the body once.
 *  2. A fresh `paragraph` CHILD (`parentId: <container>`, empty `inlineContent`,
 *     no siblings, no children) — the editable line the caret lands in.
 *  3. The link attr (`headerBlockId` / `footerBlockId`) on `sectionBlockId` is
 *     MERGED to the CONTAINER root id — mirroring `mergeBlockAttrs`' attr-merge
 *     so only the one key is touched (other section attrs, e.g. per-section
 *     page geometry, are preserved). The section block lives in the MAIN tree.
 *
 * `dirtyIds` covers the new container root, the new paragraph child (both fresh
 * templateContents keys) AND the section block (its `attrs` Y.Map changed) —
 * `captureDirtyIds` tracks all three top-level maps automatically.
 *
 * Throws if `sectionBlockId` does not resolve to a block in the main tree.
 *
 * NOTE: this op is NOT idempotent — it always creates a fresh body. The editor
 * handler (`handleInsertHeaderFooter`) enforces the "one header/footer per
 * section" rule (Google Docs) by checking for an existing linked body before
 * calling this; on a re-invocation it moves the caret into the existing body
 * rather than creating a duplicate.
 */
export function insertTemplateBody(
  state: State,
  args: InsertTemplateBodyArgs,
  allocator: IdAllocator,
): InsertTemplateBodyResult {
  const { region, sectionBlockId } = args;

  const resolved = resolveBlock(state, sectionBlockId);
  if (resolved === null) {
    throw new Error(`insertTemplateBody: section block "${sectionBlockId}" not found`);
  }
  // The link attr must land on a block in the MAIN tree (the doc root / a
  // doc-root section). A header/footer body cannot itself host a header/footer.
  if (resolved.kind !== "block") {
    throw new Error(
      `insertTemplateBody: section block "${sectionBlockId}" is in the ${resolved.kind} tree, expected the main tree`,
    );
  }

  // Pre-compute the merged attrs from the snapshot (read outside the tx, as
  // `mergeBlockAttrs` does): set only the one region key onto the existing bag.
  const attrKey = REGION_ATTR_KEY[region];

  // Allocate BOTH ids OUTSIDE applyOperation so a retry (if added later)
  // doesn't burn through multiple ids: the CONTAINER root and its paragraph
  // child.
  const bodyRootId = allocator.allocate();
  const firstParagraphId = allocator.allocate();

  const result = applyOperation(state, (doc) => {
    // Dev-mode defense against allocator id collision (counter-based test
    // allocators can collide with seeded state). Checks all three trees.
    assertNoIdCollision(doc, bodyRootId, "insertTemplateBody");
    assertNoIdCollision(doc, firstParagraphId, "insertTemplateBody");

    const templateTree = getTreeMap(doc, "templateContent");

    // (1) Materialize the CONTAINER body root into the templateContents tree.
    templateTree.set(
      bodyRootId,
      buildYBlock({
        type: "template-body",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: firstParagraphId,
        lastChildId: firstParagraphId,
        inlineContent: null,
      }),
    );

    // (2) Materialize the empty paragraph CHILD under the container.
    templateTree.set(
      firstParagraphId,
      buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: bodyRootId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }),
    );

    // (3) Merge the link attr onto the section block (main tree). Re-read the
    // section's CURRENT attrs from the snapshot via `resolved.block.attrs`
    // (a frozen pre-tx snapshot) and merge the single region key, mirroring
    // `mergeBlockAttrs`.
    const merged: ReadonlyAttrs = mergeAttrs(resolved.block.attrs, {
      [attrKey]: bodyRootId,
    });
    const ySection = getYBlock(doc, sectionBlockId, "insertTemplateBody", "block");
    ySection.set("attrs", buildYAttrs(merged));
  });

  return {
    state: result.state,
    dirtyIds: result.dirtyIds,
    bodyRootId,
    firstParagraphId,
  };
}
