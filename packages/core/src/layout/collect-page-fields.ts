import type { ElementBox, RenderNode } from "../render/render-node";
import type { ComputedStyle } from "../styles";
import { asBlockId, type BlockId } from "../state";
import { PAGE_FIELD_EMBED_TYPE, type PageFieldKind, type PageFieldNumberStyle } from "../state/page-field";

const INLINE_KEY_SEPARATOR = "/inline/";

/**
 * Identifies one page-field instance in the document. Keyed by the stable RENDER
 * KEY (`${blockId}/inline/${i}`) the render pass assigns each inline item — the
 * same key `resolvePageFields` keys its values by and `substitutePageFields` (a
 * later slice) matches on. Carries the cascaded atom's `computedStyle` so width
 * measurement (resolution + convergence) needs no separate per-key style lookup.
 */
export interface FieldSpec {
  readonly embedKey: string;
  readonly host: "template" | "main";
  readonly hostBlockId: BlockId;
  readonly fieldKind: PageFieldKind;
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
        embedKey: node.key,
        host,
        hostBlockId: asBlockId(node.key.slice(0, sepIndex)),
        fieldKind: md.fieldKind,
        numberStyle: md.numberStyle ?? "decimal",
        computedStyle: node.computedStyle,
      }),
    );
    return; // a page-field atom has no nested page-fields
  }
  for (const child of node.children) walk(child, host, out);
}
