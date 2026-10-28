import { finalSectionOf } from "../test-utils/state-builders";
import { TEST_RESOLVER } from "../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createInitialEditorState,
  reduceEditor,
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
  MAX_PROPOSAL_CHAIN,
  createPosition,
  createSpan,
  getYDoc,
  createState,
  subscribeForeignChanges,
  subscribeRemoteChanges,
  runWithTransactionOrigin,
  createEditorStateFromState,
  initialSelectionForState,
  serializeDocument,
  deserializeDocument,
  createDefaultSerializerRegistry,
  createJsonDocumentSerializer,
  productionAllocator,
  BINARY_FORMAT,
  JSON_FORMAT,
  formattingSuggestionIds,
  type EditorAction,
  type EditorConfig,
  type EditorState,
  type BlockId,
  type Position,
  type Proposal,
} from "../index";

const config: EditorConfig = {
  componentRegistry: createDefaultComponentRegistry(),
  attrRegistry: createDefaultAttrRegistry(),
  containerWidth: 800,
};

function run(editor: EditorState, cfg: EditorConfig, ...actions: EditorAction[]): EditorState {
  let s = editor;
  for (const a of actions) s = reduceEditor(s, a, cfg);
  return s;
}
const at = (id: BlockId, o: number): Position => createPosition(id, o);
const caret = (id: BlockId, o: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(at(id, o), at(id, o)) });
const runsOf = (e: EditorState, id: BlockId) =>
  (getBlock(e.state, id)?.inlineContent?.items ?? []).map((i) => [i.kind === "text" ? i.text : "￼", { ...i.attrs }] as const);
const textOf = (e: EditorState, id: BlockId): string => runsOf(e, id).map(([t]) => t).join("");

/** "The  quick fox" / "jumps over": two paragraphs; caret at the end of the second. */
function twoParagraphs(cfg: EditorConfig = config) {
  const s = run(createInitialEditorState(cfg), cfg, { type: "INSERT_TEXT", text: "The  quick fox" }, { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "jumps over" });
  const p2 = s.selection.focus.blockId;
  const p1 = getBlock(s.state, p2)?.prevSiblingId ?? null;
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
    const after = run(s, config, { type: "PROPOSE", proposal });
    expect(after.selection).toEqual(s.selection); // caret untouched (after every edit)
    const groups = getSuggestionGroups(after.state);
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
    expect(getSuggestionGroups(undo1.state).map((g) => g.id)).toEqual([proposal.groupId]);
    const redo1 = run(undo1, config, { type: "REDO" });
    expect([textOf(redo1, p1), textOf(redo1, p2)]).toEqual(proposedText);
    expect(runsOf(redo1, p2)).toEqual(runs2);
  });

  it("rejecting an untracked multi-paragraph proposal keeps the user's text (and its undo entry)", () => {
    const { after, p2, proposal } = typedThenProposed((p1) => ({ kind: "replace" as const, from: at(p1, 0), to: at(p1, 3), text: "One\nTwo" }));
    const rejected = run(after, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(getSuggestions(rejected.state)).toHaveLength(0);
    expect(textOf(rejected, p2)).toBe("jumps over!");
  });

  it("an untracked proposal is SELF to its own host's subscriptions, FOREIGN to a second host on the same doc", () => {
    const { s, p1 } = twoParagraphs();
    // A collab host: its edits carry its own origin, which its History tracks.
    const hostA = createEditorStateFromState(s.state, s.selection, config, "hostA");
    const seenByA: ReadonlySet<BlockId>[] = [];
    const seenByB: ReadonlySet<BlockId>[] = [];
    const remoteA: ReadonlySet<BlockId>[] = [];
    const remoteB: ReadonlySet<BlockId>[] = [];
    const noLegacy = (): void => {
      throw new Error("unexpected legacy storage");
    };
    const docA = getYDoc(s.state);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "sync"));
    const stateB = createState({ resolver: TEST_RESOLVER, rootId: s.state.rootId, doc: docB });
    const unsubs = [
      subscribeForeignChanges(s.state, "hostA", (ids) => seenByA.push(ids), noLegacy),
      subscribeForeignChanges(s.state, "hostB", (ids) => seenByB.push(ids), noLegacy),
      subscribeRemoteChanges(s.state, (ids) => remoteA.push(ids), noLegacy),
      subscribeRemoteChanges(stateB, (ids) => remoteB.push(ids), noLegacy),
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
    expect(textOf(runWithTransactionOrigin("hostA", () => run(after, config, { type: "UNDO" })), p1)).toBe(textOf(after, p1));
  });

  it("a proposal whose every tagged char the user's undo removes is hidden, and dropped by its group's resolve", () => {
    const { p2, after, proposal } = typedThenProposed((_p1, p) => ({
      kind: "format" as const,
      from: at(p, 10),
      to: at(p, 11),
      attrs: { bold: true },
    })); // formats exactly the typed "!"
    expect(getSuggestionGroups(after.state).map((g) => g.id)).toEqual([proposal.groupId]);
    const undone = run(after, config, { type: "UNDO" });
    expect(textOf(undone, p2)).toBe("jumps over");
    expect(getSuggestionGroups(undone.state)).toEqual([]); // nothing tagged → hidden
    expect(getSuggestions(undone.state)).toHaveLength(0); // a rangeless record is never surfaced…
    expect(getYDoc(undone.state).getMap("suggestions").size).toBe(1); // …but still exists
    const rejected = run(undone, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(getYDoc(rejected.state).getMap("suggestions").size).toBe(0); // …until its group resolves
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
    expect(getSuggestions(accepted.state)).toHaveLength(0);
    expect(textOf(accepted, p1)).toBe("The swift fox");
    expect(runsOf(accepted, p2)).toEqual([["jumps", { bold: true }], [" over", {}]]);
    const restored = run(accepted, config, { type: "UNDO" });
    expect(runsOf(restored, p1)).toEqual(runs1);
    expect(runsOf(restored, p2)).toEqual(runs2);
    expect(getSuggestionGroups(restored.state).map((g) => [g.id, g.suggestions.length])).toEqual([[proposal.groupId, 4]]);
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
    expect(getSuggestionGroups(restored.state).map((g) => [g.id, g.suggestions.length, g.metadata])).toEqual([
      [proposal.groupId, 4, { source: "assistant", reason: "tidy up" }],
    ]);
    const redone = run(restored, config, { type: "REDO" });
    expect(getSuggestions(redone.state)).toHaveLength(0);
    expect(textOf(redone, p1)).toBe("The  quick fox");
  });

  it("rejecting the group (or accepting / rejecting ONE member) resolves the whole group", () => {
    const { s, p1, p2 } = twoParagraphs();
    const proposal = proposalFor(p1, p2);
    const proposed = run(s, config, { type: "PROPOSE", proposal });
    const rejected = run(proposed, config, { type: "REJECT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(textOf(rejected, p1)).toBe("The  quick fox");
    expect(runsOf(rejected, p2)).toEqual([["jumps over", {}]]);
    expect(getSuggestions(rejected.state)).toHaveLength(0);

    const again = twoParagraphs();
    const p = proposalFor(again.p1, again.p2);
    const proposed2 = run(again.s, config, { type: "PROPOSE", proposal: p });
    const member = getSuggestions(proposed2.state).find((x) => x.kind === "formatting");
    if (member === undefined) throw new Error("no member");
    const viaMember = run(proposed2, config, { type: "ACCEPT_SUGGESTION", id: member.id });
    expect(getSuggestions(viaMember.state)).toHaveLength(0);
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
    const groups = getSuggestionGroups(e.state);
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
    const root = getBlock(accepted.state, finalSectionOf(accepted.state));
    const texts: string[] = [];
    for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(accepted.state, id)?.nextSiblingId ?? null) texts.push(textOf(accepted, id));
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
    const problem = validateProposal(first.state, clash);
    expect(problem?.kind).toBe("conflict");
    const after = run(first, config, { type: "PROPOSE", proposal: clash });
    expect(after.state).toBe(first.state); // refused whole: nothing applied
    const self: Proposal = {
      groupId: newSuggestionGroupId(),
      author: "other",
      edits: [
        { kind: "replace", from: at(p2, 0), to: at(p2, 4), text: "x" },
        { kind: "format", from: at(p2, 2), to: at(p2, 6), attrs: { italic: true } },
      ],
    };
    expect(validateProposal(s.state, self)?.kind).toBe("overlap");
  });

  it("the reducer maps a proposal from its basedOn version: lands at mapped positions, stale when its ranges changed or the version is unknown", () => {
    const { s, p1, p2 } = twoParagraphs();
    const v0 = s.state;
    const proposal = proposalFor(p1, p2);
    // The user types at the start of paragraph 1 meanwhile.
    const typed = run(s, config, caret(p1, 0), { type: "INSERT_TEXT", text: ">> " });
    const landed = run(typed, config, { type: "PROPOSE", proposal, basedOn: v0 });
    expect(landed.lastProposal).toMatchObject({ groupId: proposal.groupId, outcome: "applied" });
    expect(textOf(run(landed, config, { type: "ACCEPT_SUGGESTION_GROUP", groupId: proposal.groupId }), p1)).toBe(">> The swift fox");
    // An edit inside "quick" since v0 → stale, nothing applied.
    const edited = run(typed, config, caret(p1, 9), { type: "INSERT_TEXT", text: "Z" });
    const stale = run(edited, config, { type: "PROPOSE", proposal, basedOn: v0 });
    expect(stale.lastProposal).toMatchObject({ groupId: proposal.groupId, outcome: "stale" });
    expect(stale.state).toBe(edited.state);
    // A version that is not on the change chain (another document) → stale.
    const foreign = twoParagraphs().s.state;
    expect(run(typed, config, { type: "PROPOSE", proposal, basedOn: foreign }).lastProposal?.outcome).toBe("stale");
    // A refused proposal records why.
    const refused = run(landed, config, { type: "PROPOSE", proposal: { ...proposalFor(p1, p2), groupId: newSuggestionGroupId() } });
    expect(refused.lastProposal?.outcome).toBe("rejected");
    expect(refused.lastProposal?.problem?.kind).toBe("conflict");
  });

  it("the verdict chain keeps existing verdict objects (identity) until it is trimmed; copies keep their dispatch number", () => {
    let e = twoParagraphs().s;
    const empty = (): Proposal => ({ groupId: newSuggestionGroupId(), author: "a", edits: [] });
    e = run(e, config, { type: "PROPOSE", proposal: empty() });
    const first = e.lastProposal;
    e = run(e, config, { type: "PROPOSE", proposal: empty() });
    expect(e.lastProposal?.prior).toBe(first); // the SAME object, not a copy
    expect(e.lastProposal?.seq).toBe(2);
    for (let k = 0; k < 2 * MAX_PROPOSAL_CHAIN; k++) e = run(e, config, { type: "PROPOSE", proposal: empty() });
    const chain: number[] = [];
    for (let o = e.lastProposal; o !== undefined; o = o.prior) chain.push(o.seq);
    expect(chain.length).toBeGreaterThanOrEqual(MAX_PROPOSAL_CHAIN);
    expect(chain.length).toBeLessThanOrEqual(2 * MAX_PROPOSAL_CHAIN);
    expect(chain[0]).toBe(2 + 2 * MAX_PROPOSAL_CHAIN);
    expect(chain.every((seq, i) => i === 0 || seq === (chain[i - 1] ?? 0) - 1)).toBe(true); // consecutive
  });

  it("validation is O(n log n): ~1,000 edits cost ~n·log2(n) comparisons, not n²", () => {
    const text = "ab ".repeat(1000);
    const s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text });
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
      expect(validateProposal(s.state, proposal)).toBeNull();
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
    const decos = suggestionGroupDecorations(after.state, (g) =>
      g.metadata?.source === "assistant" ? { class: "by-assistant", style: { backgroundColor: "#eef" } } : null,
    );
    expect(decos).toHaveLength(4);
    expect(decos.every((d) => d.class === "by-assistant")).toBe(true);
  });

  it("a document with OLD-shape suggestion records (no group / metadata) still loads, lists and resolves", () => {
    // A suggesting-mode insertion, minus its `order`, is exactly the pre-group record shape.
    const old = run(createInitialEditorState(config), { ...config, suggestingAuthor: "legacy" }, { type: "INSERT_TEXT", text: "abc" });
    const yRecords = getYDoc(old.state).getMap("suggestions");
    const [legacyId] = [...yRecords.keys()];
    const yRecord = legacyId === undefined ? undefined : yRecords.get(legacyId);
    if (yRecord instanceof Y.Map) getYDoc(old.state).transact(() => yRecord.delete("order"));
    expect(yRecord instanceof Y.Map ? [...yRecord.keys()].sort() : null).toEqual(["author", "createdAt", "kind"]);
    const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
    reg.register(createJsonDocumentSerializer({ allocator: productionAllocator, blockKindResolver: config.componentRegistry }));
    const loaded = deserializeDocument(serializeDocument(old.state, BINARY_FORMAT, reg), BINARY_FORMAT, reg);
    const groups = getSuggestionGroups(loaded);
    expect(groups.map((g) => [g.id, g.author, g.metadata, g.suggestions.length])).toEqual([[legacyId, "legacy", undefined, 1]]);
    const editor = createEditorStateFromState(loaded, initialSelectionForState(loaded), config);
    const accepted = run(editor, config, { type: "ACCEPT_SUGGESTION_GROUP", groupId: legacyId ?? "" });
    expect(getSuggestions(accepted.state)).toHaveLength(0);
    expect(runsOf(accepted, accepted.selection.focus.blockId)).toEqual([["abc", {}]]);
    // JSON round-trips the new optional fields.
    const { s, p1, p2 } = twoParagraphs();
    const proposed = run(s, config, { type: "PROPOSE", proposal: proposalFor(p1, p2) });
    const back = deserializeDocument(serializeDocument(proposed.state, JSON_FORMAT, reg), JSON_FORMAT, reg);
    expect(getSuggestionGroups(back).map((g) => [g.suggestions.length, g.metadata])).toEqual([
      [4, { source: "assistant", reason: "tidy up" }],
    ]);
    // …including each record's mint `order` (strictly increasing in application order).
    const orders = (st: typeof back) => new Map(getSuggestions(st).map((x) => [x.id, x.order]));
    expect(orders(back)).toEqual(orders(proposed.state));
    expect([...orders(back).values()].every((o) => typeof o === "number")).toBe(true);
  });
});
