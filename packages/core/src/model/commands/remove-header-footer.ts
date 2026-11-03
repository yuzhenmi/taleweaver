import * as Y from "yjs";
import { resolveBlock } from "../document/blocks";
import type { Plan, Write } from "../plan";
import { BODIES_KEY } from "../storage/keys";
import { childMap } from "../storage/map-reads";
import type { CommandContext } from "./command-context";
import { selectionStart } from "./helpers/over-object";
import { plan } from "./helpers/build-plan";
import { type Region, type Variant, linkAttr, linkKey } from "./helpers/header-footer-link";
import { inSections } from "./helpers/placement";
import { sectionOwner } from "./helpers/section-owner";
import { keysWrite } from "./helpers/writes";

/**
 * S2 remove: the section shows no header / footer (`none`). A body the section links
 * itself is deleted; an inherited one is kept for the sections that own it.
 */
export function removeHeaderFooter(ctx: CommandContext, region: Region, variant: Variant = "default"): Plan | null {
  const start = selectionStart(ctx);
  if (start === null || !inSections(start)) return null;
  const d = ctx.version;
  const owner = sectionOwner(d, start);
  const bodies = childMap(d.docMap, BODIES_KEY);
  if (owner === null || bodies === null) return null;
  const key = linkKey(region, variant);
  const own = owner.get(key);
  const section = start.L.block.parentId === null ? undefined : resolveBlock(d, start.L.block.parentId)?.block;
  if (section?.attrs[linkAttr(region, variant)] === undefined) return null; // the section shows none
  const writes: Write[] = keysWrite(owner, { [key]: "none" });
  if (typeof own === "string" && bodies.get(own) instanceof Y.Map) writes.push({ k: "entry", map: bodies, key: own, value: null });
  const sel = ctx.selection;
  return plan(d, writes, () => sel);
}
