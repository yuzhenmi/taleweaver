/**
 * Seed the example app with a fairytale document authored in the human-friendly
 * `taleweaver-json` format and loaded through the `taleweaver-json`
 * `DocumentSerializer`. This is the user-facing payoff of the serialization arc
 * — the example boots on real prose rather than imperatively dispatched seed
 * actions, expressed in the readable nested block-tree JSON format.
 */
import {
  loadDocument,
  createDefaultSerializerRegistry,
  createJsonDocumentSerializer,
  JSON_FORMAT,
  productionAllocator,
  HARD_BREAK_EMBED_TYPE,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/core";

/**
 * "Little Red Riding Hood" (Brothers Grimm, "Little Red-Cap") — a well-known
 * PUBLIC-DOMAIN fairytale, authored in the human-friendly `taleweaver-json`
 * format and loaded through the `taleweaver-json` serializer. Public domain, so
 * the example carries no rights ambiguity; swap in any public-domain chapter —
 * the wiring is content-agnostic. Exercises the full supported subset: h1/h2
 * headings, paragraphs, bold/italic/link marks, an ordered + unordered list,
 * hard breaks (the famous call-and-response), and an embedded RTL phrase (the
 * engine's UAX-9 bidi reorders it from the text alone).
 *
 * STRUCTURE. The format is the kind-driven nested tree (`json-serializer.ts`):
 * the root `document` is a CONTAINER, so it carries `children`; `heading` /
 * `paragraph` / `list-item` are inline-bearing LEAVES, so they carry `content`
 * (the inline items). There is NO `list` container block — the list model is
 * FLAT (Google-Docs-style): each list item is a `list-item` LEAF sitting
 * directly among the document's children, grouped by a shared `listId` attr
 * (with `listLevel` for nesting depth), and the ordered-vs-unordered numbering
 * is supplied by a top-level `listDefs` entry keyed by that `listId`. Ids are
 * OMITTED throughout — `loadFairytale` mints them on decode.
 *
 * CASCADE ATTRS. The old HTML seed wrapped everything in a `<div lang="en"
 * hyphens="auto" style="text-align: justify">`; the HTML decoder INHERITED
 * those onto every block's attrs. The JSON format has no inheriting wrapper, so
 * the same three attrs (`lang`, `hyphens`, `textAlign`) are stamped on each
 * block directly. They make the engine's `hyphens:auto` path discover in-word
 * break points via the injected `createLiangHyphenator({ en: EN_US_PATTERN_SET })`
 * (`en-us` Liang patterns) — most visible in the justified body text, where hyphenation
 * tightens the inter-word spacing. Headings are single-line, so the `justify`
 * is a no-op on them, but it is stamped uniformly for fidelity with the prior
 * cascade.
 */

/** Listed ids that group the flat `list-item` leaves into their two lists. */
const UL_LIST_ID = "fairytale-ul";
const OL_LIST_ID = "fairytale-ol";

/** The cascade attrs the prior `<div lang hyphens style>` wrapper inherited. */
const CASCADE = { lang: "en", hyphens: "auto", textAlign: "justify" } as const;

/** A hard-break inline embed (the `<br>` of the call-and-response). */
const HARD_BREAK = { embed: HARD_BREAK_EMBED_TYPE } as const;

export const FAIRYTALE_JSON = {
  format: JSON_FORMAT,
  version: 1,
  root: {
    type: "document",
    children: [
      {
        type: "heading",
        attrs: { ...CASCADE, level: 1 },
        content: [{ text: "Little Red Riding Hood" }],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: "Once upon a time there was a dear little girl who was loved by everyone who looked at her, but most of all by her grandmother. Once she gave her a little cap of red velvet, which suited her so well that she would never wear anything else; and so she was always called ",
          },
          { text: "Little Red Riding Hood", attrs: { bold: true } },
          { text: "." },
        ],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: 'One day her mother said to her: "Come, Little Red Riding Hood, here is a piece of cake and a bottle of wine. Take them to your grandmother, who is ill and weak. Set out before it grows hot, and walk ',
          },
          { text: "nicely and quietly", attrs: { italic: true } },
          { text: ' — do not run off the path, or you may fall and break the bottle."' },
        ],
      },
      {
        type: "heading",
        attrs: { ...CASCADE, level: 2 },
        content: [{ text: "Into the Wood" }],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: "Now the grandmother lived out in the wood, half a league from the village. As Little Red Riding Hood entered the trees, a ",
          },
          { text: "wolf", attrs: { bold: true } },
          {
            text: " met her. She did not know what a wicked creature he was, and was not at all afraid of him.",
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: '"Good day, Little Red Riding Hood," said he. "Whither away so early?" She told him she was going to her grandmother, who lived among the three great oak trees beyond the mill. The wolf thought to himself how he might have them both, and walked beside her a while, pointing out the things she might gather:',
          },
        ],
      },
      {
        type: "list-item",
        attrs: { ...CASCADE, listId: UL_LIST_ID, listLevel: 0 },
        content: [
          { text: "the " },
          { text: "wild flowers", attrs: { italic: true } },
          { text: " nodding in the long grass;" },
        ],
      },
      {
        type: "list-item",
        attrs: { ...CASCADE, listId: UL_LIST_ID, listLevel: 0 },
        content: [{ text: "the birds that sang so sweetly overhead;" }],
      },
      {
        type: "list-item",
        attrs: { ...CASCADE, listId: UL_LIST_ID, listLevel: 0 },
        content: [
          { text: "the cool green hush beneath the oaks — " },
          { text: "זאב", attrs: { bold: true } },
          { text: ", the old tales call him, the wolf who waits." },
        ],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: "While Little Red Riding Hood gathered her nosegay, the wolf ran straight to the grandmother's house and knocked. He swallowed the poor grandmother whole, put on her cap and gown, and lay down in her bed to wait.",
          },
        ],
      },
      {
        type: "heading",
        attrs: { ...CASCADE, level: 2 },
        content: [{ text: "What Big Eyes You Have" }],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: "When at last the child arrived, she found the door open and the room strangely dim. She drew back the curtains of the bed, and her grandmother looked so very odd that she said:",
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          { text: '"Oh, grandmother, what big ' },
          { text: "ears", attrs: { italic: true } },
          { text: ' you have!"' },
          HARD_BREAK,
          { text: '"All the better to hear you with, my child."' },
          HARD_BREAK,
          { text: '"But, grandmother, what big ' },
          { text: "eyes", attrs: { italic: true } },
          { text: ' you have!"' },
          HARD_BREAK,
          { text: '"All the better to see you with."' },
          HARD_BREAK,
          { text: '"But, grandmother, what big ' },
          { text: "teeth", attrs: { bold: true } },
          { text: ' you have!"' },
          HARD_BREAK,
          { text: '"All the better to eat you with!"' },
        ],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: "And scarcely had the wolf said this than he sprang from the bed and swallowed up Little Red Riding Hood too. But a huntsman was passing, and hearing the snores, he cut open the sleeping wolf and freed them both, alive and well. To stay safe in the wood, the child resolved, one had only to remember three things:",
          },
        ],
      },
      {
        type: "list-item",
        attrs: { ...CASCADE, listId: OL_LIST_ID, listLevel: 0 },
        content: [{ text: "keep to the path your mother sets you;" }],
      },
      {
        type: "list-item",
        attrs: { ...CASCADE, listId: OL_LIST_ID, listLevel: 0 },
        content: [
          { text: "never stop to talk with a stranger, however kind his voice;" },
        ],
      },
      {
        type: "list-item",
        attrs: { ...CASCADE, listId: OL_LIST_ID, listLevel: 0 },
        content: [
          {
            text: "and trust the quiet voice inside that whispers when something is wrong.",
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { ...CASCADE },
        content: [
          {
            text: "So Little Red Riding Hood went home, and no one ever did her any harm again. You can read this tale and a hundred more, they say, in the old book of household stories. ",
          },
          {
            text: "Grimms' Fairy Tales",
            attrs: { link: "https://www.gutenberg.org/ebooks/2591" },
          },
          { text: " waits for anyone patient enough to turn the pages." },
        ],
      },
    ],
  },
  listDefs: {
    // Unordered list → `disc` bullets; ordered list → `decimal` numbering.
    // Mirrors the HTML decoder's `discListDef()` / `decimalListDef()` exactly.
    [UL_LIST_ID]: { levels: [{ style: "disc", start: 1, restart: "always" }] },
    [OL_LIST_ID]: { levels: [{ style: "decimal", start: 1, restart: "always" }] },
  },
} as const;

/** Build the initial EditorState for the example from FAIRYTALE_JSON, using the
 *  hook's own config (so the measurer/registries match the live editor). The
 *  JSON serializer is host-registered with the SAME component registry the
 *  editor uses (`config.componentRegistry`), so block kinds match. */
export function loadFairytale(config: EditorConfig): EditorState {
  const registry = createDefaultSerializerRegistry();
  registry.register(
    createJsonDocumentSerializer({
      allocator: productionAllocator,
      blockKindResolver: config.componentRegistry,
    }),
  );
  return loadDocument(JSON.stringify(FAIRYTALE_JSON), JSON_FORMAT, registry, config);
}
