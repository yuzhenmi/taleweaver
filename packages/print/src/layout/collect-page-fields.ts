import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import { asBlockId, CROSS_REFERENCE_EMBED_TYPE, type BlockId } from "@taleweaver/core";
import { PAGE_FIELD_EMBED_TYPE, isPageFieldNumberStyle, type PageFieldNumberStyle } from "@taleweaver/core";
import { INLINE_KEY_SEPARATOR } from "@taleweaver/core";

const TOC_KEY_SEPARATOR = "/toc/";

/**
 * Derive a field atom's host block id from its render key. A real inline field
 * atom is keyed `${blockId}/inline/${i}`; a synthesized TOC-entry page atom is
 * keyed `${tocBlockId}/toc/${i}` (its host is the plan-indexed TOC block, which
 * the fingerprint fold needs so its page numbers stay live). Returns null when
 * the key carries neither segment (caller throws).
 */
function fieldHostBlockId(key: string): BlockId | null {
  const inlineIdx = key.indexOf(INLINE_KEY_SEPARATOR);
  if (inlineIdx >= 0) return asBlockId(key.slice(0, inlineIdx));
  const tocIdx = key.indexOf(TOC_KEY_SEPARATOR);
  if (tocIdx >= 0) return asBlockId(key.slice(0, tocIdx));
  return null;
}

/**
 * Identifies one layout-field instance in the document, keyed by the stable RENDER
 * KEY (`${blockId}/inline/${i}`) the render pass assigns each inline item — the same
 * key `resolvePageFields` keys its values by and `substituteLayoutFields` matches
 * on. Carries the cascaded atom's `computedStyle` so width
 * measurement (resolution + convergence) needs no separate per-key style lookup.
 *
 * A discriminated union over `fieldType`:
 *   - {@link PageFieldSpec} — a `page-field` placeholder (page-number / page-count).
 *   - {@link CrossRefPageSpec} — a `"page"`-mode cross-reference placeholder, whose
 *     displayed value is the target block's 1-based page number (`resolvePageFields`
 *     looks up the `targetId` it additionally carries).
 */
export type FieldSpec = PageFieldSpec | CrossRefPageSpec;

export interface PageFieldSpec {
  readonly fieldType: "page-number" | "page-count";
  readonly embedKey: string;
  readonly host: "template" | "main";
  readonly hostBlockId: BlockId;
  readonly numberStyle: PageFieldNumberStyle;
  readonly computedStyle: ComputedStyle;
}

export interface CrossRefPageSpec {
  readonly fieldType: "cross-ref-page";
  readonly embedKey: string;
  readonly host: "template" | "main";
  readonly hostBlockId: BlockId;
  readonly targetId: BlockId; // the cross-ref's target block
  readonly numberStyle: PageFieldNumberStyle;
  readonly computedStyle: ComputedStyle;
}

/**
 * Walk the CASCADED render trees — the template header/footer bodies AND the main
 * tree — and emit one {@link FieldSpec} per `page-field` inline-block atom. Pure;
 * no state, no layout. MUST run over the cascaded trees (computedStyle present); a
 * page-field atom with no `computedStyle` is a programming error (a pre-cascade
 * tree) and throws rather than silently dropping the field.
 *
 * `hostBlockId` is derived from the atom's OWN render key (`${blockId}/inline/${i}`
 * → `blockId`), so it is the actual LEAF block containing the field regardless of
 * how deeply nested the atom is (e.g. a field inside a table cell several levels
 * below a top-level `rootChildren` entry). Deriving from the key — not from the
 * top-level `child.key` — avoids the `display:contents`/table-nesting hazard where
 * the top-level node is an ancestor, not the host leaf.
 */
export function collectPageFields(
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox>,
  rootChildren: readonly RenderNode[],
): FieldSpec[] {
  const out: FieldSpec[] = [];
  for (const body of cascadedTemplateContents.values()) {
    walk(body, "template", out);
  }
  for (const child of rootChildren) {
    walk(child, "main", out);
  }
  return out;
}

function walk(node: RenderNode, host: "template" | "main", out: FieldSpec[]): void {
  if (node.type !== "element") return;
  const md = node.metadata;
  if (md?.embedType === PAGE_FIELD_EMBED_TYPE && md.fieldKind !== undefined) {
    if (node.computedStyle === undefined) {
      throw new Error(
        `collectPageFields: page-field atom "${node.key}" has no computedStyle (walk must run on cascaded trees)`,
      );
    }
    const sepIndex = node.key.indexOf(INLINE_KEY_SEPARATOR);
    if (sepIndex < 0) {
      throw new Error(
        `collectPageFields: page-field atom key "${node.key}" is not an inline render key (expected "\${blockId}${INLINE_KEY_SEPARATOR}\${i}")`,
      );
    }
    out.push(
      Object.freeze({
        fieldType: md.fieldKind,
        embedKey: node.key,
        host,
        hostBlockId: asBlockId(node.key.slice(0, sepIndex)),
        numberStyle: isPageFieldNumberStyle(md.numberStyle) ? md.numberStyle : "decimal",
        computedStyle: node.computedStyle,
      }),
    );
    return; // a page-field atom has no nested page-fields
  } else if (md?.embedType === CROSS_REFERENCE_EMBED_TYPE && md.refMode === "page") {
    if (node.computedStyle === undefined) {
      throw new Error(
        `collectPageFields: cross-ref-page atom "${node.key}" has no computedStyle (walk must run on cascaded trees)`,
      );
    }
    const hostBlockId = fieldHostBlockId(node.key);
    if (hostBlockId === null) {
      throw new Error(
        `collectPageFields: cross-ref-page atom key "${node.key}" is not an inline or toc render key (expected "\${blockId}${INLINE_KEY_SEPARATOR}\${i}" or "\${tocBlockId}${TOC_KEY_SEPARATOR}\${i}")`,
      );
    }
    const rawTargetId = md.targetId;
    if (typeof rawTargetId !== "string") return; // malformed/broken target → skip (no spec)
    out.push(
      Object.freeze({
        fieldType: "cross-ref-page",
        embedKey: node.key,
        host,
        hostBlockId,
        targetId: asBlockId(rawTargetId),
        numberStyle: isPageFieldNumberStyle(md.numberStyle) ? md.numberStyle : "decimal",
        computedStyle: node.computedStyle,
      }),
    );
    return; // a cross-ref atom has no nested fields
  }
  for (const child of node.children) walk(child, host, out);
}
