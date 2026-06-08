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

/** A self-contained fairytale, authored in the human-friendly `taleweaver-html`
 *  format. Original prose (not a reproduction) so the example carries no rights
 *  ambiguity; swap in any public-domain chapter — the wiring is content-agnostic.
 *  Exercises the full supported subset: h1/h2 headings, paragraphs, bold/italic/
 *  link marks, an ordered + unordered list, hard breaks, and an embedded RTL
 *  phrase (the engine's UAX-9 bidi reorders it from the text alone). */
export const FAIRYTALE_HTML = `<h1>The Lantern-Keeper's Daughter</h1>
<p>On the edge of the world, where the cliffs lean out over a <strong>restless grey sea</strong>, there stood a lighthouse no taller than a barn. Its keeper was an old man named Orin, and his daughter, <em>Maren</em>, who could mend any broken thing with patience and a length of copper wire.</p>
<p>Each night Orin climbed the narrow stair to light the great lamp, and each night the lamp burned a little dimmer. "It is only tired," he would say. But Maren knew that tired things, like tired people, need more than kind words.</p>
<h2>The Three Gifts of the Tide</h2>
<p>One morning the sea left three gifts on the shingle, as the sea sometimes does for those who watch it closely:</p>
<ul>
<li>a brass key, green with salt and <em>warm to the touch</em>;</li>
<li>a bottle with a single word inside it, written in a script she could not read &mdash; <strong>שלום</strong>;</li>
<li>and a lantern that held no flame, yet was somehow never dark.</li>
</ul>
<p>Maren carried all three up the winding stair. She fitted the brass key to the lamp's rusted heart, and turned it once.<br>Nothing.<br>She turned it <em>twice</em>, and spoke the word from the bottle aloud, though she did not know its meaning.</p>
<h2>What the Light Remembered</h2>
<p>The lamp did not blaze. Instead it <strong>remembered</strong> &mdash; every ship it had ever guided home, every storm it had outlasted, every small boat that had found the harbour by its steady eye. The flameless lantern drank that memory and gave it back as light, soft and certain, the colour of a held breath.</p>
<p>From that night the lighthouse never dimmed again, and sailors told of a lamp that seemed to <em>know</em> them. If you should ever pass that coast, the keepers say, you have only to do three things:</p>
<ol>
<li>watch the water until it trusts you;</li>
<li>mend what others would throw away;</li>
<li>and never let a borrowed light forget where it has been.</li>
</ol>
<p>As for Maren &mdash; she keeps the lantern still, and the sea, when it is in a giving mood, still leaves her <strong>gifts</strong>. You can read the rest of her story, they say, in the old keepers' logbook, page after salt-stained page. <a href="https://example.com/keepers-log">The keepers' log</a> waits for anyone patient enough to turn the pages.</p>`;

/** Build the initial EditorState for the example from FAIRYTALE_HTML, using the
 *  hook's own config (so the measurer/registries match the live editor). */
export function loadFairytale(config: EditorConfig): EditorState {
  const registry = createDefaultSerializerRegistry();
  registry.register(createHtmlDocumentSerializer({ allocator: productionAllocator }));
  return loadDocument(FAIRYTALE_HTML, HTML_FORMAT, registry, config);
}
