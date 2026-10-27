/**
 * Digital controller, collaboration over two synced Y.Docs:
 *   - a peer's FORMAT over the user's just-typed text does not break the user's undo
 *     (one `Y.Text` per block — formatting never re-mints characters);
 *   - HALTED: a peer update carrying LEGACY inline storage halts the controller (hook
 *     once, no APPLY_FOREIGN_CHANGE, input ignored, `contenteditable` off, the screen
 *     kept, every member a defined no-op without reading the Y.Doc, decoration setters
 *     no-ops, an in-flight composition dropped); `replaceDocument` over the upgraded
 *     document — the same Y.Doc or another — resumes editing with every layer dropped.
 */
import * as Y from "yjs";
import { describe, it, expect, vi } from "vitest";
import * as core from "@taleweaver/core";
import { createDigitalController, type DigitalController, type DigitalControllerOptions } from "./digital-controller";

const cfg: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 800,
};

/** Peer A (reducer-driven, its own Y.Doc) and a digital controller B over a synced replica. */
function setup(text: string, extra: Partial<DigitalControllerOptions> = {}) {
  let peerA = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text }, cfg);
  const docA = core.getYDoc(peerA.state);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  docA.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(docB, u, "sync");
  });
  docB.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(docA, u, "sync");
  });
  core.subscribeRemoteChanges(
    peerA.state,
    (dirtyIds) => {
      peerA = core.reduceEditor(peerA, { type: "APPLY_FOREIGN_CHANGE", dirtyIds }, cfg);
    },
    () => undefined, // peer A is the old-client side in the HALTED test
  );
  const stateB = core.createState({ rootId: peerA.state.rootId, doc: docB });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const reports: core.IncompatibleDocumentReport[] = [];
  let compatible = 0;
  const controller = createDigitalController({
    container,
    componentRegistry: cfg.componentRegistry,
    attrRegistry: cfg.attrRegistry,
    containerWidth: 800,
    doc: document,
    initialState: stateB,
    onIncompatibleDocument: (r) => reports.push(r),
    onDocumentCompatible: () => compatible++,
    ...extra,
  });
  const id = peerA.selection.focus.blockId;
  return {
    controller,
    container,
    reports,
    docA,
    docB,
    id,
    rootId: peerA.state.rootId,
    compatible: () => compatible,
    a: (...actions: core.EditorAction[]) => {
      for (const action of actions) peerA = core.reduceEditor(peerA, action, cfg);
    },
  };
}

const textOf = (c: DigitalController, id: core.BlockId): string =>
  (core.getBlock(c.editorState.state, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
const span = (id: core.BlockId, a: number, b: number) => core.createSpan(core.createPosition(id, a), core.createPosition(id, b));

describe("digital — undo survives a peer's formatting", () => {
  it("B types 'hello'; A bolds 'ell'; B's Ctrl+Z removes the typing and leaves no bold", () => {
    const m = setup("");
    m.controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    m.a({ type: "SET_SELECTION", selection: span(m.id, 1, 4) }, { type: "TOGGLE_STYLE", style: "bold" });
    expect(core.getBlock(m.controller.editorState.state, m.id)?.inlineContent?.items.some((i) => i.attrs.bold === true)).toBe(true);
    m.controller.dispatch({ type: "UNDO" });
    expect(textOf(m.controller, m.id)).toBe("");
    m.controller.destroy();
  });
});

/** The run-array inline storage an OLD engine writes (one plain text run). */
function legacyRuns(text: string): Y.Array<Y.Map<unknown>> {
  const run = new Y.Map<unknown>();
  run.set("kind", "text");
  const yText = new Y.Text();
  yText.insert(0, text);
  run.set("text", yText);
  run.set("attrs", new Y.Map<unknown>());
  const runs = new Y.Array<Y.Map<unknown>>();
  runs.push([run]);
  return runs;
}

/** An old client APPENDS a never-seen paragraph (legacy storage) after `afterId`. */
function appendLegacyParagraph(doc: Y.Doc, rootId: core.BlockId, afterId: core.BlockId, text: string): core.BlockId {
  const id = "legacy-p" as core.BlockId;
  const blocks = doc.getMap<Y.Map<unknown>>("blocks");
  doc.transact(() => {
    const b = new Y.Map<unknown>();
    b.set("type", "paragraph");
    b.set("attrs", new Y.Map<unknown>());
    b.set("parentId", rootId);
    b.set("prevSiblingId", afterId);
    b.set("nextSiblingId", null);
    b.set("firstChildId", null);
    b.set("lastChildId", null);
    b.set("inlineContent", legacyRuns(text));
    blocks.set(id, b);
    blocks.get(afterId)?.set("nextSiblingId", id);
    blocks.get(rootId)?.set("lastChildId", id);
  });
  return id;
}

/** Count Y reads (map gets, text deltas, root-map lookups) on `doc` while `run` runs. */
function docReads(doc: Y.Doc, run: () => void): number {
  let reads = 0;
  const mapGet = Y.Map.prototype.get;
  const toDelta = Y.Text.prototype.toDelta;
  const getMap = Y.Doc.prototype.getMap;
  const spies = [
    vi.spyOn(Y.Map.prototype, "get").mockImplementation(function (this: Y.Map<unknown>, key: string) {
      if (this.doc === doc) reads++;
      return mapGet.call(this, key);
    }),
    vi.spyOn(Y.Text.prototype, "toDelta").mockImplementation(function (this: Y.Text, ...args: Parameters<Y.Text["toDelta"]>) {
      if (this.doc === doc) reads++;
      return toDelta.apply(this, args);
    }),
    vi.spyOn(Y.Doc.prototype, "getMap").mockImplementation(function (this: Y.Doc, name?: string) {
      if (this === doc) reads++;
      return getMap.call(this, name);
    }),
  ];
  try {
    run();
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return reads;
}

type HaltedCase = () => unknown;

const kept = (id: core.BlockId): core.Decoration => ({
  kind: "inline",
  id: "kept",
  from: core.createPosition(id, 0),
  to: core.createPosition(id, 1),
  style: { backgroundColor: "red" },
});

describe("digital — HALTED on legacy storage in a peer update", () => {
  it("halts once, keeps the screen, ignores input, every member is a no-op that never reads the Y.Doc; replaceDocument resumes with every layer dropped", async () => {
    const m = setup("hello");
    const c = m.controller;
    c.setDecorations([kept(m.id)]);
    const before = c.editorState;
    const shown = m.container.textContent;
    // An OLD client appends a never-seen (never-cached) paragraph in its run-array storage.
    const legacyId = appendLegacyParagraph(m.docA, m.rootId, m.id, "old client");
    expect(m.reports).toEqual([{ legacyBlocks: [legacyId] }]);
    expect(c.halted).toBe(true);
    expect(c.editorState).toBe(before); // no APPLY_FOREIGN_CHANGE reached the reducer
    expect(m.container.contentEditable).toBe("false");
    expect(m.container.textContent).toBe(shown); // the last good render stays
    m.docA.transact(() => m.docA.getMap<Y.Map<unknown>>("blocks").get(legacyId)?.set("inlineContent", legacyRuns("again")));
    expect(m.reports).toHaveLength(1);

    // Input into the focused editor is ignored (and its DOM mutation prevented).
    m.container.focus();
    const input = new InputEvent("beforeinput", { inputType: "insertText", data: "x", bubbles: true, cancelable: true });
    m.container.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(true);
    m.container.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    c.dispatch({ type: "INSERT_TEXT", text: "x" });
    expect(c.editorState).toBe(before);
    expect(m.container.textContent).toBe(shown);

    const pos = core.createPosition(m.id, 0);
    let results: Record<string, unknown> = {};
    const cases = {
      editorState: () => c.editorState,
      decorations: () => c.decorations,
      halted: () => c.halted,
      dispatch: () => c.dispatch({ type: "DELETE_BACKWARD" }),
      replaceDocument: () => "covered below",
      setDecorations: () => c.setDecorations([{ ...kept(m.id), id: "ignored" }]),
      setFindHighlights: () => c.setFindHighlights([{ blockId: m.id, start: 0, end: 1 }], 0),
      clearFindHighlights: () => c.clearFindHighlights(),
      setCommentHighlights: () => c.setCommentHighlights([]),
      clearCommentHighlights: () => c.clearCommentHighlights(),
      setSuggestionHighlights: () => c.setSuggestionHighlights([]),
      clearSuggestionHighlights: () => c.clearSuggestionHighlights(),
      findStart: () => c.findStart("hello"),
      findNext: () => c.findNext(),
      findPrev: () => c.findPrev(),
      findClose: () => c.findClose(),
      findStatus: () => c.findStatus(),
      replaceActive: () => c.replaceActive("x"),
      replaceAll: () => c.replaceAll("x"),
      version: () => c.version,
      mapPosition: () => c.mapPosition(pos, before.state),
      createAnchor: () => c.createAnchor(pos),
      propose: () => c.propose({ groupId: "g", author: "a", edits: [{ kind: "replace", from: pos, to: pos, text: "x" }] }),
      setSuggestionStyles: () => c.setSuggestionStyles(() => ({ style: { backgroundColor: "blue" } })),
      runCommand: () => c.runCommand(() => true),
      focus: () => c.focus(),
      destroy: () => "covered below",
    } satisfies Record<keyof DigitalController, HaltedCase>;
    const reads = docReads(m.docB, () => {
      results = Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, f()]));
    });
    expect(reads).toBe(0);
    expect(results.editorState).toBe(before);
    expect(results.version).toBe(before.state);
    expect(results.mapPosition).toBeNull();
    expect(results.createAnchor).toBeNull();
    expect(results.runCommand).toBe(false);
    expect(results.findStart).toEqual({ total: 0, activeIndex: -1 });
    await expect(results.propose).resolves.toEqual({ ok: false, reason: "halted" });
    expect(c.editorState).toBe(before);
    // Setters are no-ops: the last good host set is still reported, nothing redrawn.
    expect(c.decorations.decorations.map((d) => d.id)).toEqual(["kept"]);
    expect(m.container.textContent).toBe(shown);

    // Exit: the host upgrades a copy of the document (single authority) and replaces it.
    const upgraded = new Y.Doc();
    Y.applyUpdate(upgraded, Y.encodeStateAsUpdate(m.docB));
    expect(core.upgradeDocument(upgraded).upgradedBlocks).toEqual([legacyId]);
    c.replaceDocument(core.createState({ rootId: before.state.rootId, doc: upgraded }));
    expect(c.halted).toBe(false);
    expect(m.container.contentEditable).toBe("true");
    expect(m.container.textContent).toContain("again");
    expect(c.decorations.decorations).toEqual([]); // every layer dropped
    c.dispatch({ type: "INSERT_TEXT", text: "!" });
    expect(textOf(c, m.id)).toBe("!hello");
    c.destroy();
  });

  it("resumes on the SAME Y.Doc: an upgraded peer fires onDocumentCompatible once; replaceDocument over it resumes", () => {
    const m = setup("hello");
    const c = m.controller;
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    expect(c.halted).toBe(true);
    core.upgradeDocument(m.docA); // an upgraded peer upgrades the shared document
    expect(m.compatible()).toBe(1);
    expect(c.halted).toBe(true);
    m.a({ type: "INSERT_TEXT", text: "?" });
    expect(m.compatible()).toBe(1);
    c.replaceDocument(core.createState({ rootId: m.rootId, doc: m.docB }));
    expect(c.halted).toBe(false);
    c.dispatch({ type: "INSERT_TEXT", text: "!" });
    expect(textOf(c, m.id)).toBe("!hello?");
    // Peer changes are observed again after the resume.
    m.a({ type: "INSERT_TEXT", text: "+" });
    expect(textOf(c, m.id)).toBe("!hello?+");
    c.destroy();
  });

  it("legacy storage returning after onDocumentCompatible (before the host resumed) reports the halt again", () => {
    const m = setup("hello");
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    expect(m.reports).toHaveLength(1);
    core.upgradeDocument(m.docA);
    expect(m.compatible()).toBe(1);
    // An old client writes legacy storage again before the host replaced the document.
    m.docA.transact(() => m.docA.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("again")));
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toHaveLength(2);
    expect(m.reports[1]?.legacyBlocks).toEqual([m.id]);
    // Further legacy writes without another "compatible" stay silent.
    m.docA.transact(() => m.docA.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("more")));
    expect(m.reports).toHaveLength(2);
    m.controller.destroy();
  });

  it("replaceDocument refuses a State whose document holds legacy storage the watch never saw: stays halted, reports again, keeps watching", () => {
    const m = setup("hello");
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    core.upgradeDocument(m.docA);
    expect(m.compatible()).toBe(1);
    const fresh = core.createState({ rootId: m.rootId, doc: m.docB });
    // A local (unwatched) legacy write before the host's replaceDocument.
    m.docB.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("local"));
    const before = m.controller.editorState;
    m.controller.replaceDocument(fresh);
    expect(m.controller.halted).toBe(true);
    expect(m.controller.editorState).toBe(before);
    expect(m.reports).toHaveLength(2);
    // The document is watched halted again: its upgrade is reported.
    core.upgradeDocument(m.docB);
    expect(m.compatible()).toBe(2);
    m.controller.destroy();
  });

  it("replaceDocument (not halted) refuses another Y.Doc that gained legacy storage after createState: halts on it, keeps the old editor, watches it", () => {
    const m = setup("hello");
    const c = m.controller;
    const x = new Y.Doc();
    Y.applyUpdate(x, Y.encodeStateAsUpdate(m.docB));
    const replacement = core.createState({ rootId: m.rootId, doc: x });
    x.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("legacy"));
    const before = c.editorState;
    const destroy = vi.spyOn(before.history, "destroy");
    c.replaceDocument(replacement);
    expect(c.halted).toBe(true);
    expect(m.reports).toEqual([{ legacyBlocks: [m.id] }]);
    expect(c.editorState).toBe(before);
    expect(destroy).not.toHaveBeenCalled();
    core.upgradeDocument(x);
    expect(m.compatible()).toBe(1);
    c.destroy();
  });

  it("replaceDocument builds the new EditorState BEFORE destroying the old History (a throwing build leaves the editor intact)", () => {
    const m = setup("hello");
    const c = m.controller;
    c.dispatch({ type: "INSERT_TEXT", text: "!" });
    const destroy = vi.spyOn(c.editorState.history, "destroy");
    const build = vi.spyOn(core, "createEditorStateFromState").mockImplementation(() => {
      throw new Error("build failed");
    });
    expect(() => c.replaceDocument(core.createState({ rootId: m.rootId, doc: m.docB }))).toThrow("build failed");
    build.mockRestore();
    expect(destroy).not.toHaveBeenCalled();
    c.destroy();
  });

  it("the host upgrading the shared Y.Doc LOCALLY and replacing the document resumes peer observation", () => {
    const m = setup("hello");
    const c = m.controller;
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    core.upgradeDocument(m.docB); // a LOCAL transaction: the halted gate re-checks it too
    expect(m.compatible()).toBe(1);
    c.replaceDocument(core.createState({ rootId: m.rootId, doc: m.docB }));
    expect(c.halted).toBe(false);
    m.a({ type: "INSERT_TEXT", text: "+" });
    expect(textOf(c, m.id)).toBe("hello+");
    c.destroy();
  });

  it('halts with remoteChanges: "ignore" too (the shape check runs in every controller)', () => {
    const m = setup("hello", { remoteChanges: "ignore" });
    const before = m.controller.editorState;
    m.a({ type: "INSERT_TEXT", text: "!" });
    expect(m.controller.editorState).toBe(before); // ignored, as before
    const legacyId = appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    expect(m.reports).toEqual([{ legacyBlocks: [legacyId] }]);
    expect(m.controller.halted).toBe(true);
    m.controller.destroy();
  });

  it("a halt mid-composition drops the composed DOM text and restores the last good projection", () => {
    const m = setup("hello");
    const shown = m.container.textContent;
    m.container.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const block = m.container.querySelector(`[data-block-id="${m.id}"]`);
    if (!(block instanceof HTMLElement)) throw new Error("no block element");
    block.append("あ"); // the IME writes into the DOM
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    expect(m.controller.halted).toBe(true);
    expect(m.container.textContent).toBe(shown);
    // The IME commits later: still dropped, nothing dispatched.
    m.container.querySelector(`[data-block-id="${m.id}"]`)?.append("い");
    m.container.dispatchEvent(new CompositionEvent("compositionend", { data: "い", bubbles: true }));
    expect(m.container.textContent).toBe(shown);
    expect(textOf(m.controller, m.id)).toBe("hello");
    m.controller.destroy();
  });
});
