/**
 * Digital controller, collaboration over two synced Y.Docs:
 *   - a peer's FORMAT over the user's just-typed text does not break the user's undo
 *     (one `Y.Text` per block — formatting never re-mints characters);
 *   - HALTED: a legacy client writing into the frozen legacy root (or a replacement
 *     over a not-yet-upgraded document) halts the controller (hook
 *     once, no APPLY_FOREIGN_CHANGE, input ignored, `contenteditable` off, the screen
 *     kept, every member a defined no-op without reading the Y.Doc, decoration setters
 *     no-ops, an in-flight composition dropped); `replaceDocument` with a Document holding
 *     no legacy storage — the same Y.Doc or another — resumes editing with every layer
 *     dropped.
 */
import * as Y from "yjs";
import { describe, it, expect, vi } from "vitest";
import * as core from "@taleweaver/core";
import { createDigitalController, type DigitalController, type DigitalControllerOptions } from "./digital-controller";
import { createDefaultComponentRegistry } from "@taleweaver/core";

const TEST_RESOLVER = createDefaultComponentRegistry();

const cfg: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 800,
};

/** Peer A (reducer-driven, its own Y.Doc) and a digital controller B over a synced replica. */
function setup(text: string, extra: Partial<DigitalControllerOptions> = {}) {
  let peerA = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text });
  const docA = core.getYDoc(peerA.document);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  docA.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(docB, u, "sync");
  });
  docB.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(docA, u, "sync");
  });
  core.subscribeRemoteChanges(
    peerA.document,
    (dirtyIds) => {
      peerA = core.reduceEditor(peerA, { type: "APPLY_FOREIGN_CHANGE", dirtyIds });
    },
    () => undefined, // peer A is the old-client side in the HALTED test
  );
  const documentB = core.createDocument({ resolver: TEST_RESOLVER, rootId: peerA.document.rootId, doc: docB });
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
    initialDocument: documentB,
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
    rootId: peerA.document.rootId,
    compatible: () => compatible,
    a: (...actions: core.EditorAction[]) => {
      for (const action of actions) peerA = core.reduceEditor(peerA, action);
    },
  };
}

declare function require(id: "node:module"): { createRequire(url: string): (id: string) => unknown };

/** A peer edit decoded into `doc` by a SECOND Yjs instance (a duplicated `yjs` bundle). */
function secondInstanceWrite(from: Y.Doc, doc: Y.Doc): void {
  const Y2 = require("node:module").createRequire(import.meta.url)("yjs") as typeof Y;
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(from));
  other.getMap("meta").set("probe", 1);
  Y2.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), "foreign");
}

const textOf = (c: DigitalController, id: core.BlockId): string =>
  (core.getBlock(c.editorState.document, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
const span = (id: core.BlockId, a: number, b: number) => core.createSpan(core.createPosition(id, a), core.createPosition(id, b));

describe("digital — undo survives a peer's formatting", () => {
  it("B types 'hello'; A bolds 'ell'; B's Ctrl+Z removes the typing and leaves no bold", () => {
    const m = setup("");
    m.controller.dispatch({ type: "INSERT_TEXT", text: "hello" });
    m.a({ type: "SET_SELECTION", selection: span(m.id, 1, 4) }, { type: "TOGGLE_STYLE", style: "bold" });
    expect(core.getBlock(m.controller.editorState.document, m.id)?.inlineContent?.items.some((i) => i.attrs.bold === true)).toBe(true);
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

/**
 * A LEGACY client (a pre-schema-3 engine) writes paragraph `id` into the legacy
 * `blocks` root — frozen in a schema-3 document, so the write is a legacy write.
 */
function legacyWrite(doc: Y.Doc, text: string, id = "legacy-p"): core.BlockId {
  doc.transact(() => doc.getMap<Y.Map<unknown>>("blocks").set(id, legacyBlock("paragraph", "doc", legacyRuns(text))));
  return id as core.BlockId;
}

function legacyBlock(type: string, parentId: string | null, inline: Y.Array<Y.Map<unknown>> | null, child?: string): Y.Map<unknown> {
  const b = new Y.Map<unknown>();
  b.set("type", type);
  b.set("attrs", new Y.Map<unknown>());
  b.set("parentId", parentId);
  b.set("prevSiblingId", null);
  b.set("nextSiblingId", null);
  b.set("firstChildId", child ?? null);
  b.set("lastChildId", child ?? null);
  b.set("inlineContent", inline);
  return b;
}

/**
 * A NOT-YET-UPGRADED document: the host bound a Document to an empty Y.Doc, then a
 * schema-1 document (`doc > p1("legacy")`) synced in.
 */
function notYetUpgraded(): { doc: Y.Doc; document: core.Document; } {
  const doc = new Y.Doc();
  const document = core.createDocument({ resolver: TEST_RESOLVER, rootId: "doc" as core.BlockId, doc });
  doc.transact(() => {
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    blocks.set("doc", legacyBlock("document", null, null, "p1"));
    blocks.set("p1", legacyBlock("paragraph", "doc", legacyRuns("legacy")));
  });
  return { doc, document };
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

describe("digital — HALTED on an incompatible document", () => {
  it("halts once on a legacy write, keeps the screen, ignores input, every member is a no-op that never reads the Y.Doc; replaceDocument resumes with every layer dropped", async () => {
    const m = setup("hello");
    const c = m.controller;
    c.setDecorations([kept(m.id)]);
    const before = c.editorState;
    const shown = m.container.textContent;
    // An OLD client writes a paragraph into the frozen legacy root: surfaced with its text.
    const legacyId = legacyWrite(m.docA, "old client");
    expect(m.reports).toEqual([{ reason: "legacy-write", legacyBlocks: [legacyId], legacyText: { [legacyId]: "old client" } }]);
    expect(c.halted).toBe(true);
    expect(c.editorState).toBe(before); // no APPLY_FOREIGN_CHANGE reached the reducer
    expect(m.container.contentEditable).toBe("false");
    expect(m.container.textContent).toBe(shown); // the last good render stays
    legacyWrite(m.docA, "again", legacyId);
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
      suggestionRects: () => c.suggestionRects("s" as core.SuggestionId),
      findStart: () => c.findStart("hello"),
      findNext: () => c.findNext(),
      findPrev: () => c.findPrev(),
      findClose: () => c.findClose(),
      findStatus: () => c.findStatus(),
      replaceActive: () => c.replaceActive("x"),
      replaceAll: () => c.replaceAll("x"),
      version: () => c.version,
      mapPosition: () => c.mapPosition(pos, before.document),
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
    expect(results.version).toBe(before.document);
    expect(results.mapPosition).toBeNull();
    expect(results.createAnchor).toBeNull();
    expect(results.runCommand).toBe(false);
    expect(results.findStart).toEqual({ total: 0, activeIndex: -1 });
    await expect(results.propose).resolves.toEqual({ ok: false, reason: "halted" });
    expect(c.editorState).toBe(before);
    // Setters are no-ops: the last good host set is still reported, nothing redrawn.
    expect(c.decorations.decorations.map((d) => d.id)).toEqual(["kept"]);
    expect(m.container.textContent).toBe(shown);

    // Exit: the host REPLACES the document (here a fresh Document over the same Y.Doc).
    c.replaceDocument(core.createDocument({ resolver: TEST_RESOLVER, rootId: before.document.rootId, doc: m.docB }));
    expect(c.halted).toBe(false);
    expect(m.container.contentEditable).toBe("true");
    expect(m.container.textContent).not.toContain("again"); // surfaced, not merged
    expect(c.decorations.decorations).toEqual([]); // every layer dropped
    c.dispatch({ type: "INSERT_TEXT", text: "!" });
    expect(textOf(c, m.id)).toBe("!hello");
    c.destroy();
  });

  it("a legacy-write halt is STICKY: upgradeDocument (by a peer or locally) is a no-op and never reports compatible; replaceDocument over the same Y.Doc resumes and observes peers again", () => {
    const m = setup("hello");
    const c = m.controller;
    legacyWrite(m.docA, "old");
    expect(c.halted).toBe(true);
    expect(core.upgradeDocument(m.docA, { resolver: TEST_RESOLVER }).upgradedBlocks).toEqual([]);
    expect(core.upgradeDocument(m.docB, { resolver: TEST_RESOLVER }).upgradedBlocks).toEqual([]);
    const before = c.editorState;
    m.a({ type: "INSERT_TEXT", text: "?" }); // later peer edits stay withheld
    expect(m.compatible()).toBe(0);
    expect(c.halted).toBe(true);
    expect(c.editorState).toBe(before);
    c.replaceDocument(core.createDocument({ resolver: TEST_RESOLVER, rootId: m.rootId, doc: m.docB }));
    expect(c.halted).toBe(false);
    expect(textOf(c, m.id)).toBe("hello?");
    // Peer changes are observed again after the resume (peer A edits first: its own
    // subscription is halted by the legacy write too, so it never sees B's edits).
    m.a({ type: "INSERT_TEXT", text: "+" });
    expect(textOf(c, m.id)).toBe("hello?+");
    c.dispatch({ type: "INSERT_TEXT", text: "!" });
    expect(textOf(c, m.id)).toBe("!hello?+");
    c.destroy();
  });

  it("a newer-schema or second-Yjs-instance halt is STICKY: reported once, never onDocumentCompatible, peer edits withheld", () => {
    for (const reason of ["newer-schema", "second-yjs-instance"] as const) {
      const m = setup("hello");
      const c = m.controller;
      if (reason === "newer-schema") m.docA.getMap("meta").set("schemaVersion", core.CURRENT_SCHEMA_VERSION + 1);
      else secondInstanceWrite(m.docA, m.docB);
      expect(c.halted).toBe(true);
      expect(m.reports.map((r) => r.reason)).toEqual([reason]);
      const before = c.editorState;
      // Nothing resumes it by itself: the schema dropping back, an upgrade, later peer edits.
      if (reason === "newer-schema") m.docA.getMap("meta").set("schemaVersion", core.CURRENT_SCHEMA_VERSION);
      core.upgradeDocument(m.docB, { resolver: TEST_RESOLVER });
      m.a({ type: "INSERT_TEXT", text: "?" });
      expect(m.compatible()).toBe(0);
      expect(c.halted).toBe(true);
      expect(m.reports).toHaveLength(1);
      expect(c.editorState).toBe(before);
      c.destroy();
    }
  });

  it("replaceDocument (not halted) refuses a NOT-YET-UPGRADED document: halts on it, keeps the old editor, reports compatible once it is upgraded — and a legacy write before the resume reports again", () => {
    const m = setup("hello");
    const c = m.controller;
    const x = notYetUpgraded();
    const before = c.editorState;
    const destroy = vi.spyOn(before.history, "destroy");
    c.replaceDocument(x.document);
    expect(c.halted).toBe(true);
    expect(m.reports).toEqual([{ reason: "legacy-schema", legacyBlocks: ["doc", "p1"], legacyText: {} }]);
    expect(c.editorState).toBe(before);
    expect(destroy).not.toHaveBeenCalled();
    core.bindAttrRegistry(x.doc, cfg.attrRegistry); // the host binds before upgrading a doc no editor adopted
    core.upgradeDocument(x.doc, { resolver: TEST_RESOLVER });
    expect(m.compatible()).toBe(1);
    // A legacy client writes into the (now frozen) legacy root before the host resumed.
    x.doc.transact(() => x.doc.getMap<Y.Map<unknown>>("blocks").get("p1")?.set("inlineContent", legacyRuns("again")));
    expect(c.halted).toBe(true);
    expect(m.reports).toHaveLength(2);
    expect(m.reports[1]).toEqual({ reason: "legacy-write", legacyBlocks: ["p1"], legacyText: { p1: "again" } });
    // Further legacy writes without another "compatible" stay silent.
    x.doc.transact(() => x.doc.getMap<Y.Map<unknown>>("blocks").get("p1")?.set("inlineContent", legacyRuns("more")));
    expect(m.reports).toHaveLength(2);
    // Replacing with the upgraded document resumes; it shows the upgraded content.
    c.replaceDocument(core.createDocument({ resolver: TEST_RESOLVER, rootId: "doc" as core.BlockId, doc: x.doc }));
    expect(c.halted).toBe(false);
    expect(textOf(c, "p1" as core.BlockId)).toBe("legacy");
    c.destroy();
  });

  it("halted, replaceDocument over a NOT-YET-UPGRADED document is refused: no second report, the editor kept, its document watched (its upgrade is reported)", () => {
    const m = setup("hello");
    legacyWrite(m.docA, "old");
    const before = m.controller.editorState;
    const x = notYetUpgraded();
    m.controller.replaceDocument(x.document);
    expect(m.controller.halted).toBe(true);
    expect(m.controller.editorState).toBe(before);
    expect(m.reports).toHaveLength(1);
    core.bindAttrRegistry(x.doc, cfg.attrRegistry); // the host binds before upgrading a doc no editor adopted
    core.upgradeDocument(x.doc, { resolver: TEST_RESOLVER });
    expect(m.compatible()).toBe(1);
    m.controller.destroy();
  });

  it("replaceDocument builds the new EditorState BEFORE destroying the old History (a throwing build leaves the editor intact)", () => {
    const m = setup("hello");
    const c = m.controller;
    c.dispatch({ type: "INSERT_TEXT", text: "!" });
    const destroy = vi.spyOn(c.editorState.history, "destroy");
    const build = vi.spyOn(core, "createEditorStateFromDocument").mockImplementation(() => {
      throw new Error("build failed");
    });
    expect(() => c.replaceDocument(core.createDocument({ resolver: TEST_RESOLVER, rootId: m.rootId, doc: m.docB }))).toThrow("build failed");
    build.mockRestore();
    expect(destroy).not.toHaveBeenCalled();
    c.destroy();
  });

  it('halts with remoteChanges: "ignore" too (the shape check runs in every controller)', () => {
    const m = setup("hello", { remoteChanges: "ignore" });
    const before = m.controller.editorState;
    m.a({ type: "INSERT_TEXT", text: "!" });
    expect(m.controller.editorState).toBe(before); // ignored, as before
    const legacyId = legacyWrite(m.docA, "old");
    expect(m.reports).toEqual([{ reason: "legacy-write", legacyBlocks: [legacyId], legacyText: { [legacyId]: "old" } }]);
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
    legacyWrite(m.docA, "old");
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
