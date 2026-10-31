import type * as Y from "yjs";
import type { BlockId } from "./block-id";
import { asBlockId } from "./block-id";
import { getRegistry, entryTree } from "./registry";

/**
 * Cached sets of tree-ROOT BlockIds — registry entries flagged `root` (a footnote
 * body in `embedContent`, a header/footer template body in `templateContent`).
 *
 * Recomputed lazily, only after a ROOT entry was added / removed (a flat
 * `observe` flags staleness), so the per-keystroke render path never scans the
 * registry: O(1) per keystroke for footnote/header-heavy documents. Keyed by the
 * shared Y.Doc (Documents minted by ops share it), WeakMap so a discarded doc is
 * collected.
 */
interface Holder {
  embed: Set<BlockId>;
  template: Set<BlockId>;
  stale: boolean;
}

const holders = new WeakMap<Y.Doc, Holder>();

function getHolder(doc: Y.Doc): Holder {
  let h = holders.get(doc);
  if (h !== undefined) return h;
  const created: Holder = { embed: new Set(), template: new Set(), stale: true };
  const reg = getRegistry(doc);
  reg.observe((event) => {
    for (const [key, change] of event.changes.keys) {
      const id = asBlockId(key);
      if (change.action === "delete") {
        if (created.embed.has(id) || created.template.has(id)) created.stale = true;
      } else if (reg.get(key)?.get("root") === true) {
        created.stale = true;
      }
    }
  });
  holders.set(doc, created);
  h = created;
  return h;
}

function ensureFresh(doc: Y.Doc, h: Holder): void {
  if (!h.stale) return;
  _recomputeCounter++;
  h.embed = new Set();
  h.template = new Set();
  for (const [id, entry] of getRegistry(doc).entries()) {
    if (entry.get("root") !== true) continue;
    const tree = entryTree(entry);
    if (tree === "embedContent") h.embed.add(asBlockId(id));
    else if (tree === "templateContent") h.template.add(asBlockId(id));
  }
  h.stale = false;
}

/** Root ids of the embed-content (footnote body) tree. */
export function getEmbedContentRootIds(doc: Y.Doc): ReadonlySet<BlockId> {
  const h = getHolder(doc);
  ensureFresh(doc, h);
  return h.embed;
}

/** Root ids of the template-content (header / footer body) tree. */
export function getTemplateContentRootIds(doc: Y.Doc): ReadonlySet<BlockId> {
  const h = getHolder(doc);
  ensureFresh(doc, h);
  return h.template;
}

/** Test-only counter of root-set recomputes (perf shape assertions). */
let _recomputeCounter = 0;

export function __resetRootIdRecomputesForTest(): void {
  _recomputeCounter = 0;
}

export function __getRootIdRecomputesForTest(): number {
  return _recomputeCounter;
}
