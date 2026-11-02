import { finalSectionOf } from "../test-utils/document-builders";
import { TEST_RESOLVER } from "../test-utils/document-builders";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import {
  createEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getBlock,
  getSuggestions,
  getSuggestionGroups,
  suggestionGroupDecorations,
  validateProposal,
  setPerfTraceEnabled,
  resetPerfTrace,
  report,
  newSuggestionGroupId,
  createPosition,
  createSpan,
  getYDoc,
  createDocument,
  subscribeForeignChanges,
  subscribeRemoteChanges,
  runWithTransactionOrigin,
  serializeDocument,
  deserializeDocument,
  createDefaultSerializerRegistry,
  createJsonDocumentSerializer,
  productionAllocator,
  BINARY_FORMAT,
  JSON_FORMAT,
  formattingSuggestionIds,
  dispatchProposal,
  type ProposeResult,
  type EditorAction,
  type EditorConfig,
  type Editor,
  type BlockId,
  type Position,
  type Proposal,
} from "../index";

const config: EditorConfig = {
  componentRegistry: createDefaultComponentRegistry(),
  attrRegistry: createDefaultAttrRegistry(),
  containerWidth: 800,
};

function run(editor: Editor, cfg: EditorConfig, ...actions: EditorAction[]): Editor {
  let s = editor;
  s.setConfig(cfg);
  for (const a of actions) s.dispatch(a);
  return s;
}
const at = (id: BlockId, o: number): Position => createPosition(id, o);
const caret = (id: BlockId, o: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(at(id, o), at(id, o)) });
const runsOf = (e: Editor, id: BlockId) =>
  (getBlock(e.document, id)?.inlineContent?.items ?? []).map((i) => [i.kind === "text" ? i.text : "￼", { ...i.attrs }] as const);
const textOf = (e: Editor, id: BlockId): string => runsOf(e, id).map(([t]) => t).join("");

/** "The  quick fox" / "jumps over": two paragraphs; caret at the end of the second. */
function twoParagraphs(cfg: EditorConfig = config) {
  const s = run(createEditor(cfg), cfg, { type: "INSERT_TEXT", text: "The  quick fox" }, { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "jumps over" });
  const p2 = s.selection.focus.blockId;
  const p1 = getBlock(s.document, p2)?.prevSiblingId ?? null;
  if (p1 === null) throw new Error("setup");
  return { s, p1, p2 };
}

/** One group: drop the extra space, "quick" → "swift", bold "jumps". */
function proposalFor(p1: BlockId, p2: BlockId, groupId = newSuggestionGroupId()): Proposal {
  return {
    groupId,
    author: "assistant",
    metadata: { source: "assistant", reason: "tidy up" },
    edits: [
      { kind: "replace", from: at(p1, 3), to: at(p1, 4), text: "" },
      { kind: "replace", from: at(p1, 5), to: at(p1, 10), text: "swift", metadata: { note: "stronger word" } },
      { kind: "format", from: at(p2, 0), to: at(p2, 5), attrs: { bold: true } },
    ],
  };
}

describe("PROPOSE — host proposals as one suggestion group", () => {
  it("records every edit as a suggestion of ONE group with metadata, outside suggesting mode, without moving the caret", () => {
    const { s, p1, p2 } = twoParagraphs();
    const proposal = proposalFor(p1, p2);
    const selectionBefore = s.selection;
    const after = run(s, config, { type: "PROPOSE", proposal });
    expect(after.selection).toEqual(selectionBefore); // caret untouched (after every edit)
    const groups = getSuggestionGroups(after.document);
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g?.id).toBe(proposal.groupId);
    expect(g?.author).toBe("assistant");
    expect(g?.metadata).toEqual({ source: "assistant", reason: "tidy up" });
    // deletion + (deletion + insertion of the replace) + formatting
    expect(g?.suggestions.map((x) => x.kind).sort()).toEqual(["deletion", "deletion", "formatting", "insertion"]);
    expect(g?.suggestions.find((x) => x.kind === "insertion")?.metadata).toEqual({ source: "assistant", reason: "tidy up", note: "stronger word" });
    expect(g?.ranges.length).toBe(4);
    // The live text keeps everything (suggestions are pending).
    expect(textOf(after, p1)).toBe("The  swiftquick fox");
    expect(formattingSuggestionIds(runsOf(after, p2).find(([t]) => t === "jumps")?.[1] ?? {})).toHaveLength(1);
  });

  /** "The  quick fox" / "jumps over" + "!" typed as its own undo entry at the end of paragraph 2. */
  function typedThenProposed(edit: (p1: BlockId, p2: BlockId) => Proposal["edits"][number]) {
    const { s, p1, p2 } = twoParagraphs();
    // A caret move closes the "jumps over" typing entry; "!" is its own undo step.
    const typed = run(s, config, caret(p2, 0), caret(p2, 10), { type: "INSERT_TEXT", text: "!" });
    const proposal: Proposal = { groupId: newSuggestionGroupId(), author: "assistant", edits: [edit(p1, p2)] };
    const after = run(typed, config, { type: "PROPOSE", proposal });
    expect(after.lastProposal?.outcome).toBe("applied");
    return { typed, after, p1, p2, proposal };
  }

  it.each([
    ["inside the just-typed run", (_p1: BlockId, p2: BlockId) => ({ kind: "replace" as const, from: at(p2, 5), to: at(p2, 5), text: " high" })],
    ["replacing text next to the just-typed run", (_p1: BlockId, p2: BlockId) => ({ kind: "replace" as const, from: at(p2, 6), to: at(p2, 10), text: "past" })],
    ["formatting the just-typed run", (_p1: BlockId, p2: BlockId) => ({ kind: "format" as const, from: at(p2, 0), to: at(p2, 5), attrs: { bold: true } })],
    ["in another paragraph", (p1: BlockId) => ({ kind: "replace" as const, from: at(p1, 5), to: at(p1, 10), text: "swift" })],
    // Multi-paragraph: the new paragraphs are splits (marks), so nothing the user typed is re-minted.
    ["splitting the just-typed paragraph (multi-paragraph)", (_p1: BlockId, p2: BlockId) => ({ kind: "replace" as const, from: at(p2, 0), to: at(p2, 5), text: "One\nTwo" })],
  ])("is NOT in the user's undo stack (%s): Ctrl+Z undoes the typing, the proposal is kept; redo restores the typing", (_label, edit) => {
    const { after, p1, p2, proposal } = typedThenProposed(edit);
    const proposedText = [textOf(after, p1), textOf(after, p2)];
    const runs2 = runsOf(after, p2);
    const undo1 = run(after, config, { type: "UNDO" });
    // The user's own last edit — the typed "!" — is undone; the proposal stays.
    expect(textOf(undo1, p1)).toBe(proposedText[0]);
    expect(textOf(undo1, p2)).toBe((proposedText[1] ?? "").replace(/!$/, ""));
    expect(getSuggestionGroups(undo1.document).map((g) => g.id)).toEqual([proposal.groupId]);
    const redo1 = run(undo1, config, { type: "REDO" });
    expect([textOf(redo1, p1), textOf(redo1, p2)]).toEqual(proposedText);
    expect(runsOf(redo1, p2)).toEqual(runs2);
  });

  it("rejecting an untracked multi-paragraph proposal keeps the user's text (and its undo entry)", () => {
    const { after, p2, proposal } = typedThenProposed((p1) => ({ kind: "replace" as const, from: at(p1, 0), to: at(p1, 3), text: "One\nTwo" }));
    const rejected = run(after, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(getSuggestions(rejected.document)).toHaveLength(0);
    expect(textOf(rejected, p2)).toBe("jumps over!");
  });

  it("an untracked proposal is SELF to its own host's subscriptions, FOREIGN to a second host on the same doc", () => {
    const { s, p1 } = twoParagraphs();
    // A collab host: its edits carry its own origin, which its History tracks.
    const hostA = createEditor(config, { document: s.document, selection: s.selection, historyOrigin: "hostA" });
    const seenByA: ReadonlySet<BlockId>[] = [];
    const seenByB: ReadonlySet<BlockId>[] = [];
    const remoteA: ReadonlySet<BlockId>[] = [];
    const remoteB: ReadonlySet<BlockId>[] = [];
    const noLegacy = (): void => {
      throw new Error("unexpected legacy storage");
    };
    const docA = getYDoc(s.document);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "sync"));
    const documentB = createDocument({ resolver: TEST_RESOLVER, rootId: s.document.rootId, doc: docB });
    const unsubs = [
      subscribeForeignChanges(s.document, "hostA", (ids) => seenByA.push(ids), noLegacy),
      subscribeForeignChanges(s.document, "hostB", (ids) => seenByB.push(ids), noLegacy),
      subscribeRemoteChanges(s.document, (ids) => remoteA.push(ids), noLegacy),
      subscribeRemoteChanges(documentB, (ids) => remoteB.push(ids), noLegacy),
    ];
    const proposal: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(p1, 0), to: at(p1, 3), text: "A" }],
    };
    const after = runWithTransactionOrigin("hostA", () => run(hostA, config, { type: "PROPOSE", proposal }));
    for (const u of unsubs) u();
    expect(after.lastProposal?.outcome).toBe("applied");
    expect(seenByA).toEqual([]); // its own proposal: never an APPLY_FOREIGN_CHANGE on itself
    expect(seenByB.length).toBeGreaterThan(0); // another host on the same doc must re-render
    expect(remoteA).toEqual([]);
    expect(remoteB.length).toBeGreaterThan(0); // a synced peer sees it
    // Still untracked: the host's undo stack does not hold it.
    const proposedText = textOf(after, p1);
    expect(textOf(runWithTransactionOrigin("hostA", () => run(after, config, { type: "UNDO" })), p1)).toBe(proposedText);
  });

  it("a proposal whose every tagged char the user's undo removes is hidden, and dropped by its group's resolve", () => {
    const { p2, after, proposal } = typedThenProposed((_p1, p) => ({
      kind: "format" as const,
      from: at(p, 10),
      to: at(p, 11),
      attrs: { bold: true },
    })); // formats exactly the typed "!"
    expect(getSuggestionGroups(after.document).map((g) => g.id)).toEqual([proposal.groupId]);
    const undone = run(after, config, { type: "UNDO" });
    expect(textOf(undone, p2)).toBe("jumps over");
    expect(getSuggestionGroups(undone.document)).toEqual([]); // nothing tagged → hidden
    expect(getSuggestions(undone.document)).toHaveLength(0); // a rangeless record is never surfaced…
    expect(getYDoc(undone.document).getMap("suggestions").size).toBe(1); // …but still exists
    const rejected = run(undone, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(getYDoc(rejected.document).getMap("suggestions").size).toBe(0); // …until its group resolves
  });

  it("keeps stored typing attrs: collapsed bold, a proposal lands elsewhere, the typed text is still bold", () => {
    const { s, p1, p2 } = twoParagraphs();
    const armed = run(s, config, { type: "TOGGLE_STYLE", style: "bold" });
    expect(armed.storedAttrs).toEqual({ bold: true });
    const after = run(armed, config, {
      type: "PROPOSE",
      proposal: { groupId: newSuggestionGroupId(), author: "assistant", edits: [{ kind: "replace", from: at(p1, 0), to: at(p1, 3), text: "A" }] },
    });
    expect(after.storedAttrs).toEqual({ bold: true });
    const typed = run(after, config, { type: "INSERT_TEXT", text: "X" });
    expect(runsOf(typed, p2).find(([t]) => t === "X")?.[1]).toEqual({ bold: true });
  });

  it("rebases a caret placed after an insertion in the same paragraph", () => {
    const { s, p1 } = twoParagraphs();
    const before = run(s, config, caret(p1, 14));
    const after = run(before, config, {
      type: "PROPOSE",
      proposal: { groupId: newSuggestionGroupId(), author: "assistant", edits: [{ kind: "replace", from: at(p1, 0), to: at(p1, 0), text: "So " }] },
    });
    expect(after.selection.focus).toEqual(at(p1, 17));
  });

  it("accepting the group applies every edit atomically as ONE undo step; undo restores the group exactly", () => {
    const { s, p1, p2 } = twoParagraphs();
    const proposal = proposalFor(p1, p2);
    const proposed = run(s, config, { type: "PROPOSE", proposal });
    const runs1 = runsOf(proposed, p1);
    const runs2 = runsOf(proposed, p2);
    const accepted = run(proposed, config, { type: "ACCEPT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(getSuggestions(accepted.document)).toHaveLength(0);
    expect(textOf(accepted, p1)).toBe("The swift fox");
    expect(runsOf(accepted, p2)).toEqual([["jumps", { bold: true }], [" over", {}]]);
    const restored = run(accepted, config, { type: "UNDO" });
    expect(runsOf(restored, p1)).toEqual(runs1);
    expect(runsOf(restored, p2)).toEqual(runs2);
    expect(getSuggestionGroups(restored.document).map((g) => [g.id, g.suggestions.length])).toEqual([[proposal.groupId, 4]]);
    // Redo re-accepts.
    expect(textOf(run(restored, config, { type: "REDO" }), p1)).toBe("The swift fox");
  });

  it("rejecting is ONE undo step: undo restores the group exactly, redo rejects again", () => {
    const { s, p1, p2 } = twoParagraphs();
    const proposal = proposalFor(p1, p2);
    const proposed = run(s, config, { type: "PROPOSE", proposal });
    const runs1 = runsOf(proposed, p1);
    const runs2 = runsOf(proposed, p2);
    const rejected = run(proposed, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(textOf(rejected, p1)).toBe("The  quick fox");
    const restored = run(rejected, config, { type: "UNDO" });
    expect(runsOf(restored, p1)).toEqual(runs1);
    expect(runsOf(restored, p2)).toEqual(runs2);
    expect(getSuggestionGroups(restored.document).map((g) => [g.id, g.suggestions.length, g.metadata])).toEqual([
      [proposal.groupId, 4, { source: "assistant", reason: "tidy up" }],
    ]);
    const redone = run(restored, config, { type: "REDO" });
    expect(getSuggestions(redone.document)).toHaveLength(0);
    expect(textOf(redone, p1)).toBe("The  quick fox");
  });

  it("rejecting the group (or accepting / rejecting ONE member) resolves the whole group", () => {
    const { s, p1, p2 } = twoParagraphs();
    const proposal = proposalFor(p1, p2);
    const proposed = run(s, config, { type: "PROPOSE", proposal });
    const rejected = run(proposed, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(textOf(rejected, p1)).toBe("The  quick fox");
    expect(runsOf(rejected, p2)).toEqual([["jumps over", {}]]);
    expect(getSuggestions(rejected.document)).toHaveLength(0);

    const again = twoParagraphs();
    const p = proposalFor(again.p1, again.p2);
    const proposed2 = run(again.s, config, { type: "PROPOSE", proposal: p });
    const member = getSuggestions(proposed2.document).find((x) => x.kind === "formatting");
    if (member === undefined) throw new Error("no member");
    const viaMember = run(proposed2, config, { type: "ACCEPT_SUGGESTION", id: member.id });
    expect(getSuggestions(viaMember.document)).toHaveLength(0);
    expect(textOf(viaMember, again.p1)).toBe("The swift fox");
  });

  it("works in suggesting mode too, and a user's adjacent suggestion never joins the group", () => {
    const suggesting: EditorConfig = { ...config, suggestingAuthor: "assistant" };
    const { s, p1 } = twoParagraphs();
    const proposal: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(p1, 14), to: at(p1, 14), text: "!" }],
    };
    let e = run(s, suggesting, { type: "PROPOSE", proposal }, caret(p1, 15), { type: "INSERT_TEXT", text: "?" });
    const groups = getSuggestionGroups(e.document);
    expect(groups).toHaveLength(2); // the proposal + the user's own (same author) insertion
    e = run(e, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(textOf(e, p1)).toBe("The  quick fox?");
  });

  it("supports multi-paragraph replacement text", () => {
    const { s, p1 } = twoParagraphs();
    const proposal: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(p1, 10), to: at(p1, 14), text: " fox.\nNew line" }],
    };
    const after = run(s, config, { type: "PROPOSE", proposal });
    const accepted = run(after, config, { type: "ACCEPT_SUGGESTION_GROUP", groupId: proposal.groupId });
    const root = getBlock(accepted.document, finalSectionOf(accepted.document));
    const texts: string[] = [];
    for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(accepted.document, id)?.nextSiblingId ?? null) texts.push(textOf(accepted, id));
    expect(texts).toEqual(["The  quick fox.", "New line", "jumps over"]);
  });
});

describe("proposal overlaps and staleness", () => {
  it("a proposal overlapping a pending suggestion is refused whole (and one overlapping itself)", () => {
    const { s, p1, p2 } = twoParagraphs();
    const first = run(s, config, { type: "PROPOSE", proposal: proposalFor(p1, p2) });
    const clash: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "other",
      edits: [
        { kind: "replace", from: at(p2, 6), to: at(p2, 10), text: "under" },
        { kind: "format", from: at(p2, 1), to: at(p2, 3), attrs: { italic: true } }, // inside the pending bold proposal
      ],
    };
    const problem = validateProposal(first.document, clash);
    expect(problem?.kind).toBe("conflict");
    const firstDocument = first.document;
    const after = run(first, config, { type: "PROPOSE", proposal: clash });
    expect(after.document).toBe(firstDocument); // refused whole: nothing applied
    const self: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "other",
      edits: [
        { kind: "replace", from: at(p2, 0), to: at(p2, 4), text: "x" },
        { kind: "format", from: at(p2, 2), to: at(p2, 6), attrs: { italic: true } },
      ],
    };
    expect(validateProposal(s.document, self)?.kind).toBe("overlap");
  });

  it("the reducer maps a proposal from its basedOn version: lands at mapped positions, stale when its ranges changed or the version is unknown", () => {
    // Each continuation on a fresh setup (a dispatch changes the editor in place).
    const setup = () => {
      const { s, p1, p2 } = twoParagraphs();
      const v0 = s.document;
      const proposal = proposalFor(p1, p2);
      // The user types at the start of paragraph 1 meanwhile.
      const typed = run(s, config, caret(p1, 0), { type: "INSERT_TEXT", text: ">> " });
      return { typed, v0, proposal, p1, p2 };
    };
    const a = setup();
    const landed = run(a.typed, config, { type: "PROPOSE", proposal: a.proposal, basedOn: a.v0 });
    expect(landed.lastProposal).toMatchObject({ groupId: a.proposal.groupId, outcome: "applied" });
    // A refused proposal records why.
    const refused = run(landed, config, { type: "PROPOSE", proposal: { ...proposalFor(a.p1, a.p2), groupId: newSuggestionGroupId() } });
    expect(refused.lastProposal?.outcome).toBe("rejected");
    expect(refused.lastProposal?.problem?.kind).toBe("conflict");
    expect(textOf(run(refused, config, { type: "ACCEPT_SUGGESTION_GROUP", groupId: a.proposal.groupId }), a.p1)).toBe(">> The swift fox");
    // An edit inside "quick" since v0 → stale, nothing applied.
    const b = setup();
    const edited = run(b.typed, config, caret(b.p1, 9), { type: "INSERT_TEXT", text: "Z" });
    const editedDocument = edited.document;
    const stale = run(edited, config, { type: "PROPOSE", proposal: b.proposal, basedOn: b.v0 });
    expect(stale.lastProposal).toMatchObject({ groupId: b.proposal.groupId, outcome: "stale" });
    expect(stale.document).toBe(editedDocument);
    // A version that is not on the change chain (another document) → stale.
    const c = setup();
    const foreign = twoParagraphs().s.document;
    expect(run(c.typed, config, { type: "PROPOSE", proposal: c.proposal, basedOn: foreign }).lastProposal?.outcome).toBe("stale");
  });

  it("validation is O(n log n): ~1,000 edits cost ~n·log2(n) comparisons, not n²", () => {
    const text = "ab ".repeat(1000);
    const s = run(createEditor(config), config, { type: "INSERT_TEXT", text });
    const id = s.selection.focus.blockId;
    const n = 1000;
    // Shuffled (deterministic) so the sort does real work.
    const order = Array.from({ length: n }, (_, k) => (k * 7919) % n);
    const proposal: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "assistant",
      edits: order.map((k) => ({ kind: "replace" as const, from: at(id, k * 3), to: at(id, k * 3 + 2), text: "xy" })),
    };
    resetPerfTrace();
    setPerfTraceEnabled(true);
    try {
      expect(validateProposal(s.document, proposal)).toBeNull();
    } finally {
      setPerfTraceEnabled(false);
    }
    const compares = report().entries.find((e) => e.label === "proposal.validateCompare")?.count ?? 0;
    expect(compares).toBeGreaterThan(0); // the counter is live
    expect(compares).toBeLessThanOrEqual(2 * n * Math.log2(n)); // n² would be 1,000,000
  });
});

describe("rendering hook and compatibility", () => {
  it("suggestionGroupDecorations styles every range of the groups the host picks", () => {
    const { s, p1, p2 } = twoParagraphs();
    const after = run(s, config, { type: "PROPOSE", proposal: proposalFor(p1, p2) });
    const decos = suggestionGroupDecorations(after.document, (g) =>
      g.metadata?.source === "assistant" ? { class: "by-assistant", style: { backgroundColor: "#eef" } } : null,
    );
    expect(decos).toHaveLength(4);
    expect(decos.every((d) => d.class === "by-assistant")).toBe(true);
  });

  it("a document with OLD-shape suggestion records (no group / metadata) still loads, lists and resolves", () => {
    // A suggesting-mode insertion, minus its `order`, is exactly the pre-group record shape.
    const old = run(createEditor(config), { ...config, suggestingAuthor: "legacy" }, { type: "INSERT_TEXT", text: "abc" });
    const yRecords = getYDoc(old.document).getMap("suggestions");
    const [legacyId] = [...yRecords.keys()];
    const yRecord = legacyId === undefined ? undefined : yRecords.get(legacyId);
    if (yRecord instanceof Y.Map) getYDoc(old.document).transact(() => yRecord.delete("order"));
    expect(yRecord instanceof Y.Map ? [...yRecord.keys()].sort() : null).toEqual(["author", "createdAt", "kind"]);
    const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
    reg.register(createJsonDocumentSerializer({ allocator: productionAllocator, blockKindResolver: config.componentRegistry }));
    const loaded = deserializeDocument(serializeDocument(old.document, BINARY_FORMAT, reg), BINARY_FORMAT, reg);
    const groups = getSuggestionGroups(loaded);
    expect(groups.map((g) => [g.id, g.author, g.metadata, g.suggestions.length])).toEqual([[legacyId, "legacy", undefined, 1]]);
    const editor = createEditor(config, { document: loaded });
    const accepted = run(editor, config, { type: "ACCEPT_SUGGESTION_GROUP", groupId: legacyId ?? "" });
    expect(getSuggestions(accepted.document)).toHaveLength(0);
    expect(runsOf(accepted, accepted.selection.focus.blockId)).toEqual([["abc", {}]]);
    // JSON round-trips the new optional fields.
    const { s, p1, p2 } = twoParagraphs();
    const proposed = run(s, config, { type: "PROPOSE", proposal: proposalFor(p1, p2) });
    const back = deserializeDocument(serializeDocument(proposed.document, JSON_FORMAT, reg), JSON_FORMAT, reg);
    expect(getSuggestionGroups(back).map((g) => [g.suggestions.length, g.metadata])).toEqual([
      [4, { source: "assistant", reason: "tidy up" }],
    ]);
    // …including each record's mint `order` (strictly increasing in application order).
    const orders = (st: typeof back) => new Map(getSuggestions(st).map((x) => [x.id, x.order]));
    expect(orders(back)).toEqual(orders(proposed.document));
    expect([...orders(back).values()].every((o) => typeof o === "number")).toBe(true);
  });
});

describe("dispatchProposal — the verdict a host's propose() resolves with", () => {
  const NOT_APPLIED = { ok: false, reason: "rejected", problem: { kind: "invalid", message: "not applied" } };
  const replaceIn = (id: BlockId, from: number, to: number, text = "x"): Proposal => ({
    groupId: newSuggestionGroupId(),
    author: "assistant",
    edits: [{ kind: "replace", from: at(id, from), to: at(id, to), text }],
  });
  /** Count `editor`'s live subscriptions. */
  const countSubscriptions = (editor: Editor): (() => number) => {
    let live = 0;
    const subscribe = editor.subscribe.bind(editor);
    editor.subscribe = (listener) => {
      live++;
      const off = subscribe(listener);
      return () => {
        live--;
        off();
      };
    };
    return () => live;
  };
  const failingNow = (editor: Editor): EditorConfig => ({
    ...editor.config,
    now: () => {
      throw new Error("clock failed");
    },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatched directly: resolves with the verdict", async () => {
    const { s, p1 } = twoParagraphs();
    expect(await dispatchProposal(s, replaceIn(p1, 0, 3))).toEqual({ ok: true });
    expect(getSuggestionGroups(s.document)).toHaveLength(1);
  });

  it("queued (from a subscriber): each resolves with its own verdict once it runs — the same object twice too", async () => {
    const { s, p1 } = twoParagraphs();
    const same = replaceIn(p1, 0, 3);
    const pending: Promise<ProposeResult>[] = [];
    const off = s.subscribe(() => {
      off();
      pending.push(dispatchProposal(s, same), dispatchProposal(s, replaceIn(p1, 1, 4)), dispatchProposal(s, same));
    });
    s.dispatch(caret(p1, 0));
    const [a, b, c] = await Promise.all(pending);
    expect(a).toEqual({ ok: true });
    expect(b?.ok === false && b.reason === "rejected" ? b.problem.kind : null).toBe("conflict");
    expect(c?.ok === false && c.reason === "rejected" ? c.problem.kind : null).toBe("conflict");
  });

  it("queued behind edits: its positions refer to the document when it was proposed", async () => {
    const { s, p1 } = twoParagraphs();
    let queued: Promise<ProposeResult> | undefined;
    const off = s.subscribe(() => {
      off();
      s.dispatch(caret(p1, 0));
      s.dispatch({ type: "INSERT_TEXT", text: "XYZ " });
      queued = dispatchProposal(s, replaceIn(p1, 5, 10, "swift")); // "quick" before the queued edits
    });
    s.dispatch(caret(p1, 1));
    expect(await queued).toEqual({ ok: true });
    const [group] = getSuggestionGroups(s.document);
    if (group === undefined) throw new Error("no group");
    s.dispatch({ type: "ACCEPT_SUGGESTION_GROUP", groupId: group.id });
    expect(textOf(s, p1)).toBe("XYZ The  swift fox");
  });

  it("a subscriber that throws on its change does not stop it: resolves with the verdict", async () => {
    vi.stubGlobal("queueMicrotask", () => undefined); // the subscriber's error report
    const { s, p1 } = twoParagraphs();
    const off = s.subscribe(({ action }) => {
      if (action.type !== "PROPOSE") return;
      off();
      throw new Error("host failed");
    });
    expect(await dispatchProposal(s, replaceIn(p1, 0, 3))).toEqual({ ok: true });
    expect(getSuggestionGroups(s.document)).toHaveLength(1);
  });

  it("a PROPOSE that throws: rejected — rethrown when dispatched directly, reported when queued; nothing stays subscribed", async () => {
    vi.stubGlobal("queueMicrotask", () => undefined); // the queued action's error report
    const { s, p1 } = twoParagraphs();
    const live = countSubscriptions(s);
    const working = s.config;
    s.setConfig(failingNow(s));
    expect(() => dispatchProposal(s, replaceIn(p1, 0, 3))).toThrow("clock failed");
    expect(live()).toBe(0);
    s.setConfig(working);
    let queued: Promise<ProposeResult> | undefined;
    const off = s.subscribe(() => {
      off();
      s.setConfig(failingNow(s));
      queued = dispatchProposal(s, replaceIn(p1, 0, 3));
    });
    s.dispatch(caret(p1, 0));
    expect(await queued).toEqual(NOT_APPLIED);
    expect(live()).toBe(0);
    expect(getSuggestionGroups(s.document)).toEqual([]);
  });
});
