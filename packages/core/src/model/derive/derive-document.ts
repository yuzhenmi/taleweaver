/**
 * The total read model (r7 §4) and from-scratch derivation of an immutable version.
 *
 * Read rules applied here (tables, R6–R10, are P2):
 *   - R1 paragraph: a run ended by a ¶; attrs = the ¶'s `p:*` (`p:type` = the block
 *     type, default "paragraph"), `m:*` = markAttrs, `t:ins` / `t:del` =
 *     breakSuggestion; absent keys = defaults. An EMPTY run before a block object,
 *     `[S]` or `<end>` is nothing.
 *   - R2 debris (X1): a non-empty run ended by a block object / `[S]` reads as a
 *     default paragraph `${terminator}/pre`; ended by `<end>`, `${holder}/end`.
 *   - R4 sections: the body flow's `[S]` items partition it; section `${S}/section`
 *     takes the `[S]`'s `s:*`; the last section `${root}/final` takes DocMap's. A
 *     section with no paragraph has no children. `[S]` outside the body flow is a
 *     terminator only (it ends a run; nothing else).
 *   - R5 header links: `h:<region>:<variant>` (region header|footer, variant
 *     default|first|even; no other spelling is read) = an existing bodyId → that
 *     body (`h/${bodyId}`, see `ids.ts`); `none` → none; absent / missing body / a
 *     non-string → inherit the previous section's. `s:` keys spelled like a link attr
 *     are not read.
 *   - R11 lists: see `listLevelConfig` (`document/list-levels.ts`).
 *   - Footnote bodies (X20): `${anchor}/body` in the embedContents tree; a body with
 *     no flow reads as R17.
 *   - R17 empty holder: a flow whose read yields no paragraph and no block object
 *     (no ¶ and no content, or only `[S]`s) reads as one empty default paragraph
 *     `${holder}/end`.
 *   - A `p:type` naming a container / block-object type reads as "paragraph"; only
 *     scalar values (null or non-object) of prefixed keys are read.
 *
 * Every read is independent of Y.Map iteration order (keys are read by their exact
 * canonical spelling or sorted), so peers holding the same storage read the same.
 */
import * as Y from "yjs";
import type { Document } from "../document/types";
import { templateBodyId } from "../ids";
import type { ObjectKindRegistry } from "../object-kinds";
import { getDocMap } from "../storage/doc-map";
import { typeId } from "../storage/item-id";
import { BODIES_KEY } from "../storage/keys";
import { childMap, flowOf } from "../storage/map-reads";
import { deriveFlow } from "./derive-flow";
import { readListDefs } from "./list-defs";
import { Working } from "./working";

// ---------------------------------------------------------------------------
// From scratch
// ---------------------------------------------------------------------------

/** Derive the whole document from storage. Throws when the document has no schema-4 root. */
export function deriveDocument(doc: Y.Doc, registry: ObjectKindRegistry): Document {
  const docMap = getDocMap(doc);
  const rootId = docMap === null ? null : typeId(docMap);
  if (docMap === null || rootId === null) throw new Error("model: document has no schema-4 root");
  const w = new Working(rootId, docMap, registry, null);
  deriveAll(w);
  return w.finish();
}

export function deriveAll(w: Working): void {
  deriveFlow(w, w.rootId, "block", flowOf(w.docMap), true);
  childMap(w.docMap, BODIES_KEY)?.forEach((body, bodyId) => {
    if (body instanceof Y.Map) deriveFlow(w, templateBodyId(bodyId), "templateContent", flowOf(body), false);
  });
  w.listDefs = readListDefs(w.docMap);
}
