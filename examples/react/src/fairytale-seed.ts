/**
 * Slice 3 of the human-friendly serializer arc: seed the example app with a
 * fairytale document authored in the human-friendly `taleweaver-html` format and
 * loaded through the `taleweaver-html` `DocumentSerializer`. This is the
 * user-facing payoff of the serialization arc — the example boots on real prose
 * rather than imperatively dispatched seed actions.
 */
import {
  loadDocument,
  createDefaultSerializerRegistry,
  productionAllocator,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/core";
import { createHtmlDocumentSerializer, HTML_FORMAT } from "@taleweaver/dom";

/** "Little Red Riding Hood" (Brothers Grimm, "Little Red-Cap") — a well-known
 *  PUBLIC-DOMAIN fairytale, authored in the human-friendly `taleweaver-html`
 *  format and loaded through the `taleweaver-html` serializer. Public domain, so
 *  the example carries no rights ambiguity; swap in any public-domain chapter —
 *  the wiring is content-agnostic. Exercises the full supported subset: h1/h2
 *  headings, paragraphs, bold/italic/link marks, an ordered + unordered list,
 *  hard breaks (the famous call-and-response), and an embedded RTL phrase (the
 *  engine's UAX-9 bidi reorders it from the text alone). */
export const FAIRYTALE_HTML = `<h1>Little Red Riding Hood</h1>
<p>Once upon a time there was a dear little girl who was loved by everyone who looked at her, but most of all by her grandmother. Once she gave her a little cap of red velvet, which suited her so well that she would never wear anything else; and so she was always called <strong>Little Red Riding Hood</strong>.</p>
<p>One day her mother said to her: "Come, Little Red Riding Hood, here is a piece of cake and a bottle of wine. Take them to your grandmother, who is ill and weak. Set out before it grows hot, and walk <em>nicely and quietly</em> &mdash; do not run off the path, or you may fall and break the bottle."</p>
<h2>Into the Wood</h2>
<p>Now the grandmother lived out in the wood, half a league from the village. As Little Red Riding Hood entered the trees, a <strong>wolf</strong> met her. She did not know what a wicked creature he was, and was not at all afraid of him.</p>
<p>"Good day, Little Red Riding Hood," said he. "Whither away so early?" She told him she was going to her grandmother, who lived among the three great oak trees beyond the mill. The wolf thought to himself how he might have them both, and walked beside her a while, pointing out the things she might gather:</p>
<ul>
<li>the <em>wild flowers</em> nodding in the long grass;</li>
<li>the birds that sang so sweetly overhead;</li>
<li>the cool green hush beneath the oaks &mdash; <strong>זאב</strong>, the old tales call him, the wolf who waits.</li>
</ul>
<p>While Little Red Riding Hood gathered her nosegay, the wolf ran straight to the grandmother's house and knocked. He swallowed the poor grandmother whole, put on her cap and gown, and lay down in her bed to wait.</p>
<h2>What Big Eyes You Have</h2>
<p>When at last the child arrived, she found the door open and the room strangely dim. She drew back the curtains of the bed, and her grandmother looked so very odd that she said:</p>
<p>"Oh, grandmother, what big <em>ears</em> you have!"<br>"All the better to hear you with, my child."<br>"But, grandmother, what big <em>eyes</em> you have!"<br>"All the better to see you with."<br>"But, grandmother, what big <strong>teeth</strong> you have!"<br>"All the better to eat you with!"</p>
<p>And scarcely had the wolf said this than he sprang from the bed and swallowed up Little Red Riding Hood too. But a huntsman was passing, and hearing the snores, he cut open the sleeping wolf and freed them both, alive and well. To stay safe in the wood, the child resolved, one had only to remember three things:</p>
<ol>
<li>keep to the path your mother sets you;</li>
<li>never stop to talk with a stranger, however kind his voice;</li>
<li>and trust the quiet voice inside that whispers when something is wrong.</li>
</ol>
<p>So Little Red Riding Hood went home, and no one ever did her any harm again. You can read this tale and a hundred more, they say, in the old book of household stories. <a href="https://www.gutenberg.org/ebooks/2591">Grimms' Fairy Tales</a> waits for anyone patient enough to turn the pages.</p>`;

/** Build the initial EditorState for the example from FAIRYTALE_HTML, using the
 *  hook's own config (so the measurer/registries match the live editor). */
export function loadFairytale(config: EditorConfig): EditorState {
  const registry = createDefaultSerializerRegistry();
  registry.register(createHtmlDocumentSerializer({ allocator: productionAllocator }));
  return loadDocument(FAIRYTALE_HTML, HTML_FORMAT, registry, config);
}
