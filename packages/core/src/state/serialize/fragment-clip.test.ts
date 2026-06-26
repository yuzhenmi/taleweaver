import { describe, it, expect } from "vitest";
import { encodeFragmentClip, decodeFragmentClip, TALEWEAVER_CLIP_MIME } from "./fragment-clip";
import { extractFragment } from "../ops/extract-fragment";
import { createSpan, createPosition } from "../block-position";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import { getBlock, getEmbedContent } from "../state";
import { buildBlock, inlineContent, text, embed } from "../../test-utils/state-builders";
import { buildStateFromBlocks } from "../build-state-from-blocks";
import {
  INSERTION_SUGGESTION_ATTR,
  readSuggestionRecordFromState,
  type SuggestionId,
  type SuggestionRecord,
} from "../suggestions";
import { suggestionIdsOnItem } from "../ops/suggestion-ops";

// ─── Helpers mirroring extract-fragment.test.ts ──────────────────────────────

function bid(s: string): BlockId {
  return s as BlockId;
}

/** Top-level block types under the fragment's root. */
function fragTopLevelTypes(frag: State): string[] {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return [];
  const types: string[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    types.push(block.type);
    cur = block.nextSiblingId;
  }
  return types;
}

/**
 * Returns suggestion records stored in the state. Harvests provenance ids
 * via the canonical `suggestionIdsOnItem` (text attrs + break-embed
 * `properties.suggestionId` + embed FORMATTING_SUGGESTION_ATTR), then reads
 * each record back out of the state's suggestions side-table.
 */
function suggestionRecordsOf(frag: State): readonly SuggestionRecord[] {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return [];
  const ids = new Set<string>();
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    if (block.inlineContent) {
      for (const item of block.inlineContent.items) {
        for (const id of suggestionIdsOnItem(item)) ids.add(id);
      }
    }
    cur = block.nextSiblingId;
  }
  return [...ids]
    .map((id) => readSuggestionRecordFromState(frag, id as SuggestionId))
    .filter((r): r is SuggestionRecord => r !== null);
}

/** True iff the fragment has any embed content (footnote bodies etc.) */
function fragHasEmbedContent(frag: State): boolean {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return false;
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    if (block.inlineContent) {
      for (const item of block.inlineContent.items) {
        if (item.kind === "embed" && typeof item.properties["contentBlockId"] === "string") {
          const cbId = item.properties["contentBlockId"] as BlockId;
          const body = getEmbedContent(frag, cbId);
          if (body !== null) return true;
        }
      }
    }
    cur = block.nextSiblingId;
  }
  return false;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FOOTNOTE_EMBED_TYPE = "footnote-anchor";

/**
 * A rich state with a paragraph containing a footnote anchor + embed content
 * AND a text run carrying a pending insertion suggestion.
 */
function buildRichState(): State {
  return buildStateFromBlocks({
    rootId: bid("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([
          text("Hello ", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
          embed(FOOTNOTE_EMBED_TYPE, { contentBlockId: "fnbody" }),
          text(" World"),
        ]),
      }),
    ],
    embedContents: [
      buildBlock({
        id: "fnbody",
        type: "footnote-body",
        firstChildId: "fnp",
        lastChildId: "fnp",
      }),
      buildBlock({
        id: "fnp",
        type: "paragraph",
        parentId: "fnbody",
        inlineContent: inlineContent([text("Footnote text")]),
      }),
    ],
    suggestions: [
      { id: "s1" as SuggestionId, kind: "insertion", author: "Alice", createdAt: 0 },
    ],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("fragment-clip codec", () => {
  it("MIME constant is the agreed private type", () => {
    expect(TALEWEAVER_CLIP_MIME).toBe("application/x-taleweaver-clip");
  });

  it("round-trips a fragment State losslessly (blocks + marks + footnotes + suggestions)", () => {
    const richState = buildRichState();
    // Select the entire paragraph: "Hello " (6) + footnote embed (1) + " World" (6) = 13
    const span = createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 13));
    const frag = extractFragment(richState, span);

    const clip = encodeFragmentClip(frag);
    expect(typeof clip).toBe("string");
    expect(clip.length).toBeGreaterThan(0);

    const back = decodeFragmentClip(clip);
    expect(back).not.toBeNull();
    const backState = back as State;

    // Same top-level block types
    expect(fragTopLevelTypes(backState)).toEqual(fragTopLevelTypes(frag));

    // Suggestion records survive the round-trip
    const origRecords = suggestionRecordsOf(frag);
    const backRecords = suggestionRecordsOf(backState);
    expect(backRecords.map((r) => r.id)).toEqual(origRecords.map((r) => r.id));
    expect(backRecords.map((r) => r.kind)).toEqual(origRecords.map((r) => r.kind));
    expect(backRecords.map((r) => r.author)).toEqual(origRecords.map((r) => r.author));

    // Footnote embed content survives
    expect(fragHasEmbedContent(backState)).toBe(true);
  });

  it("encodeFragmentClip returns a valid base64 string", () => {
    const richState = buildRichState();
    const span = createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 13));
    const frag = extractFragment(richState, span);
    const clip = encodeFragmentClip(frag);
    // Valid standard base64: only A-Za-z0-9+/= chars and length is a multiple of 4
    expect(clip).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(clip.length % 4).toBe(0);
  });

  it("returns null on malformed clip — not base64", () => {
    expect(decodeFragmentClip("@@@")).toBeNull();
  });

  it("returns null on malformed clip — valid base64 but not a valid document", () => {
    // "AAAA" decodes to 3 zero bytes — not a valid Yjs doc
    expect(decodeFragmentClip("AAAA")).toBeNull();
  });

  it("decodeFragmentClip never throws — always returns State or null", () => {
    // Garbage strings that are neither base64 nor valid docs
    for (const bad of ["", "!!!!", "not-base64-at-all", "AAAAAAAAAA=="]) {
      expect(() => decodeFragmentClip(bad)).not.toThrow();
    }
  });
});
