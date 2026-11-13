import { resolveBlock } from "../document/blocks";
import type { Plan, Write } from "../plan";
import { caretAt } from "../position/model-position";
import { typeId } from "../storage/item-id";
import { BODIES_KEY } from "../storage/keys";
import { childMap } from "../storage/map-reads";
import { newBody, newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { selectionStart } from "./helpers/over-object";
import { plan } from "./helpers/build-plan";
import { freshBodyId } from "./helpers/body-id";
import { type Region, type Variant, linkAttr, linkKey } from "./helpers/header-footer-link";
import { inSections } from "./helpers/placement";
import { sectionOwner } from "./helpers/section-owner";
import { keysWrite } from "./helpers/writes";

/**
 * S2 insert: link a new header / footer body (one ¶) on the focus's section and put
 * the caret in it. A section that already shows one (its own or inherited, R5)
 * gets the caret in that body instead (GDocs: one header per section; Word: "Same as
 * Previous" edits the shared one).
 */
export function insertHeaderFooter(ctx: CommandContext, region: Region, variant: Variant = "default"): Plan | null {
  const start = selectionStart(ctx);
  if (start === null || !inSections(ctx.version, start)) return null;
  const d = ctx.version;
  const section = start.L.block.parentId === null ? null : resolveBlock(d, start.L.block.parentId)?.block;
  const owner = sectionOwner(d, start);
  const bodies = childMap(d.docMap, BODIES_KEY);
  const doc = d.docMap.doc;
  if (section === undefined || section === null || owner === null || bodies === null || doc === null) return null;
  const existing = section.attrs[linkAttr(region, variant)];
  if (typeof existing === "string") {
    const first = resolveBlock(d, existing)?.block.firstChildId;
    if (first === undefined || first === null) return null;
    return plan(d, [], () => caretAt(first, 0));
  }
  const bodyId = freshBodyId(doc);
  const mark = newParagraphMark();
  const writes: Write[] = [{ k: "entry", map: bodies, key: bodyId, value: newBody(mark) }, ...keysWrite(owner, { [linkKey(region, variant)]: bodyId })];
  const sel = ctx.selection;
  return plan(d, writes, () => {
    const id = typeId(mark);
    return id === null ? sel : caretAt(id, 0);
  });
}
