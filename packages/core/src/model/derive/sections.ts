import * as Y from "yjs";
import { BLOCK_TYPES, type BlockId } from "../block";
import { templateBodyId } from "../ids";
import { BODIES_KEY } from "../storage/keys";
import { childMap, scalarsWithPrefix } from "../storage/map-reads";
import { EMPTY_ATTRS, containerRecord } from "./records";
import type { Working } from "./working";

// ---------------------------------------------------------------------------
// Sections (R4 / R5) and the root record
// ---------------------------------------------------------------------------

/** R5's link slots: the only `h:` keys read, and the section attrs they resolve to. */
export const HEADER_LINKS: readonly { readonly key: string; readonly attr: string }[] = ["header", "footer"].flatMap((region) =>
  ["default", "first", "even"].map((variant) => ({
    key: `h:${region}:${variant}`,
    attr: variant === "default" ? `${region}BlockId` : `${region}${variant.charAt(0).toUpperCase()}${variant.slice(1)}BlockId`,
  })),
);
const LINK_ATTRS: ReadonlySet<string> = new Set(HEADER_LINKS.map((l) => l.attr));

/** Rewrite every section record's attrs (s:* + R5 links) and sibling links, and the root record. */
export function writeSections(w: Working): void {
  const fs = w.flows.get(w.rootId);
  if (fs === undefined) return;
  const bodies = childMap(w.docMap, BODIES_KEY);
  const inherited = new Map<string, BlockId | null>();
  fs.sections.forEach((s, i) => {
    const attrs: Record<string, unknown> = scalarsWithPrefix(s.map, "s:");
    for (const a of LINK_ATTRS) delete attrs[a];
    for (const { key, attr } of HEADER_LINKS) {
      const raw = s.map.get(key);
      let link = inherited.get(key) ?? null;
      if (raw === "none") link = null;
      else if (typeof raw === "string" && bodies?.get(raw) instanceof Y.Map) link = templateBodyId(raw);
      inherited.set(key, link);
      if (link !== null) attrs[attr] = link;
    }
    const old = w.get(fs.tree, s.id);
    w.put(
      fs.tree,
      containerRecord(
        s.id,
        BLOCK_TYPES.section,
        Object.freeze(attrs),
        { parentId: w.rootId, prevSiblingId: fs.sections[i - 1]?.id ?? null, nextSiblingId: fs.sections[i + 1]?.id ?? null },
        old?.firstChildId ?? null,
        old?.lastChildId ?? null,
      ),
    );
  });
  w.put(
    fs.tree,
    containerRecord(w.rootId, BLOCK_TYPES.document, EMPTY_ATTRS, { parentId: null, prevSiblingId: null, nextSiblingId: null }, fs.sections[0]?.id ?? null, fs.sections[fs.sections.length - 1]?.id ?? null),
  );
}
