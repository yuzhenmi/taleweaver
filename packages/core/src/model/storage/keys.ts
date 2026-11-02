/**
 * Schema-4 storage (yjs-valid-by-definition r7 §3).
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
 *   - `br`: an inline line break (Shift+Enter; Word `\v`, GDocs `\u000b`);
 *   - `field`: an inline field `{field, numberStyle?}` (`field` ∈ page-number|page-count);
 *   - `sectionBreak`: `[S]`, holding the props (`s:*`, `h:*`) of the section it ends;
 *   - `toc`: a table-of-contents block object (`a:*` options);
 *   - `table`: a table block object `{a:*, rows: Y.Array<RowMap>, cols: Y.Array<ColMap>}`;
 *     ColMap `{key, weight?}`; RowMap `{key, header?, a:*, c:<col>:a:*,
 *     c:<col>:rowSpanTo: rowKey, c:<col>:colSpanTo: colKey, c:<col>:flow}` — a cell is
 *     the slot (row key, column key), its content the `c:<col>:flow` flow (`table-keys.ts`);
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
export const ROWS_KEY = "rows";
export const COLS_KEY = "cols";
/** A row's / column's track key (rows and columns are addressed by key, never by index). */
export const TRACK_KEY = "key";
export const HEADER_KEY = "header";
export const WEIGHT_KEY = "weight";

export const ITEM_KINDS = {
  para: "para",
  object: "object",
  hr: "hr",
  lineBreak: "br",
  field: "field",
  sectionBreak: "sectionBreak",
  toc: "toc",
  table: "table",
  footnote: "footnote",
  marker: "marker",
  sub: "sub",
} as const;
