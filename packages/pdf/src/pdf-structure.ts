// packages/pdf/src/pdf-structure.ts
//
// #526 (T4) — the pdf-package-local structure MODEL. A `PdfStructureNode` tree
// mirrors the core `AccessibilityNode` projection but speaks PDF's standard
// structure-element vocabulary (`Document`/`P`/`H1..H6`/`L`/`LI`/`Table`/…)
// instead of ARIA roles. `mapAccessibilityTree` is the pure mapping. The
// emit-pdf consumer that turns this tree into a `/StructTreeRoot` + marked-
// content is the NEXT task (T5); this module only defines the model + mapping.

import type { AccessibilityNode, AccessibilityRole } from "@taleweaver/core";

/**
 * The subset of PDF standard structure types (PDF 32000-1:2008 §14.8.4) this
 * engine emits. `Lbl`/`LBody` are produced by the T5 consumer's LI split (using
 * the page-emitter's marker-ownership info) — NOT by this model, which keeps a
 * `listitem` as a plain `LI`.
 */
export type PdfStructRole =
  | "Document"
  | "P"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H5"
  | "H6"
  | "L"
  | "LI"
  | "Lbl"
  | "LBody"
  | "Table"
  | "TR"
  | "TD"
  | "TH"
  | "Figure"
  | "Note"
  | "TOC";

/**
 * A node in the pdf-package structure model. `blockId` is the source block id (a
 * string) or `null` for synthetic grouping nodes (e.g. a `list` synthesized from
 * a run of list-items). `alt` carries a figure's alternate text.
 */
export interface PdfStructureNode {
  readonly role: PdfStructRole;
  readonly blockId: string | null;
  readonly alt?: string;
  readonly children: readonly PdfStructureNode[];
}

/** Clamp a heading level to the valid 1..6 band, defaulting absent to 1. */
function headingRole(level: number | undefined): PdfStructRole {
  const clamped = Math.min(6, Math.max(1, level ?? 1));
  switch (clamped) {
    case 1:
      return "H1";
    case 2:
      return "H2";
    case 3:
      return "H3";
    case 4:
      return "H4";
    case 5:
      return "H5";
    default:
      return "H6";
  }
}

/**
 * The PDF structure role for an accessibility role, or `null` when the node must
 * NOT appear in the structure tree (its ENTIRE subtree is dropped — running
 * header/footer content is /Artifact, carries no MCID):
 *  - `banner` / `contentinfo`: running header/footer content, drawn as
 *    /Artifact by the page-emitter — never tagged structure.
 *  - `separator`: a horizontal rule, decorative → /Artifact.
 *  - decorative `img` (`name === ""`): an explicitly-decorative image → no
 *    /Figure. A labeled image (`name` non-empty) maps to `Figure` (handled by
 *    the caller, which also carries the alt). An absent/unlabeled name (the
 *    builder defaults `img` name to `""`, so this is the same as decorative)
 *    likewise produces no node.
 */
function roleOf(role: AccessibilityRole, name: string | undefined): PdfStructRole | null {
  switch (role) {
    case "document":
      return "Document";
    case "paragraph":
      return "P";
    case "list":
      return "L";
    case "listitem":
      return "LI";
    case "table":
      return "Table";
    case "row":
      return "TR";
    case "cell":
      return "TD";
    case "columnheader":
      return "TH";
    case "doc-footnote":
      return "Note";
    case "navigation":
      return "TOC";
    case "img":
      // Labeled → Figure; decorative ("") / unlabeled → dropped.
      return name !== undefined && name !== "" ? "Figure" : null;
    case "heading":
      // The caller supplies the level (see mapNode); a bare heading defaults H1.
      return "H1";
    case "separator":
    case "banner":
    case "contentinfo":
      return null;
    default: {
      // `AccessibilityRole` is a closed union; every member is handled above.
      // A new member must add a case here. Fail loud rather than silently
      // dropping a node (an invisible accessibility regression).
      const exhaustive: never = role;
      throw new Error(`mapAccessibilityTree: unmapped accessibility role "${String(exhaustive)}"`);
    }
  }
}

/**
 * Map a node's children, dropping nulls. A child that maps to a node keeps it
 * (with its own recursively-mapped children); a child that maps to `null` is
 * excluded from the structure tree along with its ENTIRE subtree — its children
 * are NOT hoisted to this level. The only dropped roles with children are
 * banner/contentinfo (running header/footer content), which T3 tags as
 * /Artifact and emits no MCID for; a hoisted child would be a dangling
 * empty-/K structure node referencing no marked content.
 */
function mapChildren(nodes: readonly AccessibilityNode[]): PdfStructureNode[] {
  const out: PdfStructureNode[] = [];
  for (const child of nodes) {
    const mapped = mapNode(child);
    if (mapped !== null) out.push(mapped);
    // else: the node is excluded from the structure tree along with its ENTIRE
    // subtree. The only dropped roles with children are banner/contentinfo
    // (running header/footer content), which T3 tags as /Artifact and emits no
    // MCID for — a hoisted child would be a dangling empty-/K structure node.
  }
  return out;
}

/** Map a single node to a `PdfStructureNode`, or `null` if it must be dropped. */
function mapNode(node: AccessibilityNode): PdfStructureNode | null {
  const role = node.role === "heading" ? headingRole(node.level) : roleOf(node.role, node.name);
  if (role === null) return null;

  const blockId: string | null = node.sourceBlockId;
  const alt = node.role === "img" ? node.name : undefined;

  return {
    role,
    blockId,
    ...(alt !== undefined && alt !== "" ? { alt } : {}),
    children: mapChildren(node.children),
  };
}

/**
 * Map a core `AccessibilityNode` tree to the pdf-package structure model.
 *
 * Returns `null` for nodes that must NOT appear in the structure tree
 * (banner/contentinfo running content, separators, decorative images) — their
 * drawn content is tagged `/Artifact` by the page-emitter, so their ENTIRE
 * subtree is dropped (running header/footer content is /Artifact, carries no
 * MCID — a hoisted child would dangle as an empty-/K structure node). (#526)
 */
export function mapAccessibilityTree(node: AccessibilityNode): PdfStructureNode | null {
  return mapNode(node);
}
