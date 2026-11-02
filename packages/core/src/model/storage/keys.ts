/**
 * Schema-4 storage (yjs-valid-by-definition r7 §3), tables excluded (P2).
 *
 * Root: `doc.getMap("v4").get("doc")` = DocMap, created together with
 * `meta.schemaVersion = 4`. DocMap keys:
 *   - `flow`: the body flow, a `Y.Array<Y.Text>` of PIECES (X11);
 *   - `s:*` / `h:<region>:<variant>`: the LAST section's props;
 *   - `bodies`: `Y.Map<bodyId, BodyMap{flow}>` header / footer bodies (X19 base);
 *   - `listDefs`, `comments`, `suggestions`: side maps.
 *
 * A flow's content is the pieces' character sequence. Every item kind other than
 * text is an embedded `Y.Map` whose `k` key names it (written at creation, never
 * rewritten):
 *   - `para`: a ¶ (flat keys `p:*` paragraph attrs, `m:*` ¶-mark run props,
 *     `t:ins` / `t:del` tracked-break tags);
 *   - `object`: a generic inline object `{kind, w?, h?, wrap?, a:<prop>…}`; images
 *     are kind `"image"` (`a:src`, `a:alt`); `wrap` ∈ left|right|break, absent = inline;
 *   - `hr`: an inline horizontal rule;
 *   - `sectionBreak`: `[S]`, holding the props (`s:*`, `h:*`) of the section it ends;
 *   - `toc`: a table-of-contents block object (`a:*` options);
 *   - `footnote`: an inline footnote anchor whose `body` is a nested `Y.Map{flow}` (X20);
 *   - `marker`: a generic range marker `{ns, id, edge: "start"|"end"}` (bookmarks,
 *     comment anchors);
 *   - `sub`: a SUB-FLOW `Y.Map{pieces}` read in place (X12).
 *
 * Every holder flow is created holding one ¶ (G3). Writes carry the editor's
 * `Symbol` origin (X16); history uses {@link flowContainerDeleteFilter} (X17).
 *
 * Yjs internals read (X14, item-level reads): `AbstractType._item/_start`,
 * `Item.parent/parentSub/right/deleted/countable/length/content/id`.
 */
export const SCHEMA_VERSION = 4;
export const ROOT_MAP = "v4";
export const DOC_KEY = "doc";
export const META_MAP = "meta";
export const SCHEMA_VERSION_KEY = "schemaVersion";

export const FLOW_KEY = "flow";
export const BODIES_KEY = "bodies";
export const LIST_DEFS_KEY = "listDefs";
export const COMMENTS_KEY = "comments";
export const SUGGESTIONS_KEY = "suggestions";
export const KIND_KEY = "k";
export const PIECES_KEY = "pieces";
export const BODY_KEY = "body";

export const ITEM_KINDS = {
  para: "para",
  object: "object",
  hr: "hr",
  sectionBreak: "sectionBreak",
  toc: "toc",
  footnote: "footnote",
  marker: "marker",
  sub: "sub",
} as const;
