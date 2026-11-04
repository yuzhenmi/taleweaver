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
 *   - a table is a BRACKET of marks in its flow, each holding its nesting depth `d`
 *     (tables continuous-text design §1): `table` (`⟦`, `{d, a:*, cols: Y.Array<Y.Map{w?}>}`,
 *     `cols[i]` = grid column i), `row` (`⟨r⟩`, `{d, header?, a:*}`), `cell` (`⟨c⟩`,
 *     `{d, colSpan?, rowSpan?, a:*}`) and `tableEnd` (`⟧`, `{d}`). A cell's content is
 *     what follows its `⟨c⟩` up to its table's next mark (`derive/table/`);
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
/** A table mark's nesting depth (Word `itap`): 0 for a table in a flow, +1 per enclosing table. */
export const DEPTH_KEY = "d";
export const COLS_KEY = "cols";
export const WIDTH_KEY = "w";
export const HEADER_KEY = "header";
export const ROW_SPAN_KEY = "rowSpan";
export const COL_SPAN_KEY = "colSpan";

export const ITEM_KINDS = {
  para: "para",
  object: "object",
  hr: "hr",
  lineBreak: "br",
  field: "field",
  sectionBreak: "sectionBreak",
  toc: "toc",
  table: "table",
  row: "row",
  cell: "cell",
  tableEnd: "tableEnd",
  footnote: "footnote",
  marker: "marker",
  sub: "sub",
} as const;
