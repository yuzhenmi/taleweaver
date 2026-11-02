import * as Y from "yjs";
import { resolveBlock } from "../document/blocks";
import type { Plan, Write } from "../plan";
import { BODIES_KEY } from "../storage/keys";
import { childMap } from "../storage/map-reads";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { type Region, type Variant, linkAttr, linkKey } from "./helpers/header-footer-link";
import { inMainTree } from "./helpers/in-main-tree";
import { sectionOwner } from "./helpers/section-owner";
import { keysWrite } from "./helpers/writes";

/**
 * S2 remove: the section shows no header / footer (`none`). A body the section links
 * itself is deleted; an inherited one is kept for the sections that own it.
 */
export function removeHeaderFooter(ctx: CommandContext, region: Region, variant: Variant = "default"): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || !inMainTree(r.start)) return null;
  const d = ctx.version;
  const owner = sectionOwner(d, r.start);
  const bodies = childMap(d.docMap, BODIES_KEY);
  if (owner === null || bodies === null) return null;
  const key = linkKey(region, variant);
  const own = owner.get(key);
  const section = r.start.L.block.parentId === null ? undefined : resolveBlock(d, r.start.L.block.parentId)?.block;
  if (section?.attrs[linkAttr(region, variant)] === undefined) return null; // the section shows none
  const writes: Write[] = keysWrite(owner, { [key]: "none" });
  if (typeof own === "string" && bodies.get(own) instanceof Y.Map) writes.push({ k: "entry", map: bodies, key: own, value: null });
  const sel = ctx.selection;
  return plan(d, writes, () => sel);
}
