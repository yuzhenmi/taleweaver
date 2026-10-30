/**
 * HALTED print controller: a legacy client writing into the frozen legacy root of a
 * schema-3 document (or a replacement over a not-yet-upgraded document) halts the
 * controller — the host hook fires once with an `IncompatibleDocumentReport`, no
 * APPLY_FOREIGN_CHANGE is dispatched, typing does nothing (browser defaults are not
 * prevented), the screen keeps the last good render, every member of the controller
 * interface has a defined no-op result without reading the Y.Doc, decoration setters
 * are no-ops, and a document replacement through `update` (a FRESH State holding no
 * legacy storage — the same Y.Doc or another one) resumes editing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController, type EditorControllerOptions } from "./index";
import { createDefaultComponentRegistry } from "@taleweaver/core";

const TEST_RESOLVER = createDefaultComponentRegistry();

let originalGetContext: PropertyDescriptor | undefined;
let originalIO: typeof IntersectionObserver | undefined;
/** Every string painted with `fillText`, in order. */
let painted: string[] = [];
/** The fill style of every `fillRect`, in order. */
let fills: string[] = [];
/** Page slots the mocked IntersectionObserver has been asked to observe, by page index. */
let observeCb: ((el: Element, visible: boolean) => void) | null = null;
let slots = new Map<number, Element>();

beforeEach(() => {
  painted = [];
  fills = [];
  slots = new Map();
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      const noop = () => {};
      return {
        canvas: this, font: "", fillStyle: "", strokeStyle: "", textBaseline: "alphabetic", lineWidth: 1,
        globalAlpha: 1, lineJoin: "miter", measureText: (t: string) => ({ width: t.length * 8 }),
        fillRect(this: { fillStyle: string }) {
          fills.push(this.fillStyle);
        },
        fillText: (t: string) => painted.push(t), clearRect: noop, moveTo: noop, lineTo: noop,
        stroke: noop, drawImage: noop, setTransform: noop, save: noop, restore: noop, scale: noop,
        beginPath: noop, closePath: noop, arc: noop, rect: noop, clip: noop, fill: noop, strokeRect: noop,
        setLineDash: noop,
      };
    },
    writable: true,
    configurable: true,
  });
  // Paginated mounts: only page 0 starts visible; a test reveals others explicitly.
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => {
    observeCb = (el, visible) =>
      cb([{ target: el, isIntersecting: visible } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    return {
      observe: (el: Element) => {
        const idx = Number((el as HTMLElement).dataset.pageIndex);
        slots.set(idx, el);
        if (idx === 0) observeCb?.(el, true);
      },
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    };
  }) as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  if (originalIO !== undefined) globalThis.IntersectionObserver = originalIO;
  observeCb = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const cfg: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
};

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
 * A NOT-YET-UPGRADED document: the host bound an EditorState to an empty Y.Doc, then a
 * schema-1 document (`doc > p1("legacy")`) synced in.
 */
function notYetUpgraded(): { doc: Y.Doc; editorState: core.EditorState } {
  const doc = new Y.Doc();
  const state = core.createState({ resolver: TEST_RESOLVER, rootId: "doc" as core.BlockId, doc });
  const editorState = core.createEditorStateFromState(state, core.initialSelectionForState(state), cfg);
  doc.transact(() => {
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    blocks.set("doc", legacyBlock("document", null, null, "p1"));
    blocks.set("p1", legacyBlock("paragraph", "doc", legacyRuns("legacy")));
  });
  return { doc, editorState };
}

/** A FRESH EditorState over `doc` (a document replacement, not a descendant). */
function freshOver(doc: Y.Doc, rootId: core.BlockId): core.EditorState {
  const state = core.createState({ resolver: TEST_RESOLVER, rootId, doc });
  return core.createEditorStateFromState(state, core.initialSelectionForState(state), cfg);
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

type HaltedCase = () => unknown;

/** Peer A (an engine of its own) and the controller under test on peer B's doc (synced A → B). */
function setup(text = "hello", extra: Partial<EditorControllerOptions> = {}, config: core.EditorConfig = cfg) {
  let peerA = core.reduceEditor(core.createInitialEditorState(config), { type: "INSERT_TEXT", text });
  const docA = core.getYDoc(peerA.state);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
  const stateB = core.createState({ resolver: TEST_RESOLVER, rootId: peerA.state.rootId, doc: docB });
  let current = core.createEditorStateFromState(stateB, core.initialSelectionForState(stateB), config);
  const actions: core.EditorAction[] = [];
  const reports: core.IncompatibleDocumentReport[] = [];
  let compatible = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let controller: EditorController | null = null;
  controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    dispatch: (a) => {
      actions.push(a);
      current = core.reduceEditor(current, a);
      controller?.update(current);
    },
    onIncompatibleDocument: (r) => reports.push(r),
    onDocumentCompatible: () => compatible++,
    ...extra,
  });
  controller.update(current);
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  const id = peerA.selection.focus.blockId;
  return {
    controller,
    container,
    textarea,
    actions,
    reports,
    docA,
    docB,
    id,
    rootId: peerA.state.rootId,
    compatible: () => compatible,
    get: () => current,
    set: (e: core.EditorState) => (current = e),
    /** Peer A edits through its own engine (an up-to-date client). */
    peer: (action: core.EditorAction) => {
      peerA = core.reduceEditor(peerA, action);
    },
    /** Peer A's caret block. */
    peerFocus: () => peerA.selection.focus.blockId,
  };
}

/** Count Y reads (map gets, text deltas) on `doc` while `run` runs. */
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

function typeInto(textarea: HTMLTextAreaElement, text: string): KeyboardEvent {
  textarea.focus();
  const key = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  textarea.dispatchEvent(key);
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return key;
}

describe("print — HALTED on an incompatible document", () => {
  it("halts once on a legacy write, keeps the screen, ignores focused typing without preventing defaults, every member is a no-op that never reads the Y.Doc; a fresh State resumes", async () => {
    const m = setup();
    const c = m.controller;
    c.setDecorations([{ kind: "inline", id: "kept", from: core.createPosition(m.id, 0), to: core.createPosition(m.id, 1), style: { backgroundColor: "red" } }]);
    // A comment over "he", highlighted (a layer re-derived from the document).
    c.runCommand((_s, d) => {
      if (d === undefined) return true;
      d({ type: "SET_SELECTION", selection: core.createSpan(core.createPosition(m.id, 0), core.createPosition(m.id, 2)) });
      d({ type: "ADD_COMMENT", id: "c1" as core.CommentId, author: "a", body: "b", createdAt: 1 });
      return true;
    });
    c.setCommentHighlights([{ commentId: "c1" as core.CommentId, active: false }]);
    expect(fills).toContain(core.COMMENT_HIGHLIGHT_FILL);
    m.actions.length = 0;
    const before = m.get();
    // An OLD client writes a paragraph into the frozen legacy root: surfaced with its text.
    const legacyId = legacyWrite(m.docA, "old client");
    expect(m.reports).toEqual([{ reason: "legacy-write", legacyBlocks: [legacyId], legacyText: { [legacyId]: "old client" } }]);
    expect(c.halted).toBe(true);
    expect(m.actions.some((a) => a.type === "APPLY_FOREIGN_CHANGE")).toBe(false);
    expect(m.get()).toBe(before); // the host state is unchanged

    // A second legacy update does not call the hook again.
    legacyWrite(m.docA, "again", legacyId);
    expect(m.reports).toHaveLength(1);

    // Typing into the FOCUSED textarea does nothing; the keydown default is not prevented.
    painted = [];
    const key = typeInto(m.textarea, "x");
    expect(key.defaultPrevented).toBe(false);
    expect(m.actions).toHaveLength(0);
    expect(m.textarea.value).toBe("");
    // The screen keeps the last good render: nothing but the old text is ever painted.
    expect(painted.join("")).not.toMatch(/old client|again|x/);

    // Every member: a defined result, no throw, no Y.Doc read.
    const pos = core.createPosition(m.id, 0);
    let results: Record<string, unknown> = {};
    const cases = {
      halted: () => c.halted,
      update: () => c.update(m.get()), // the halted State itself: ignored
      focus: () => c.focus(),
      destroy: () => "covered below",
      getCaretRect: () => c.getCaretRect(pos),
      runCommand: () => c.runCommand(() => true),
      version: () => c.version,
      mapPosition: () => c.mapPosition(pos, before.state),
      createAnchor: () => c.createAnchor(pos),
      propose: () => c.propose({ groupId: "g", author: "a", edits: [{ kind: "replace", from: pos, to: pos, text: "x" }] }),
      setSuggestionStyles: () => c.setSuggestionStyles(() => ({ style: { backgroundColor: "blue" } })),
      exportToPdf: () => {
        try {
          c.exportToPdf(() => new Uint8Array());
          return "no throw";
        } catch (err) {
          return err instanceof Error ? err.message : "?";
        }
      },
      decorations: () => c.decorations,
      setDecorations: () => c.setDecorations([{ kind: "inline", id: "ignored", from: pos, to: core.createPosition(m.id, 1), style: { backgroundColor: "red" } }]),
      setFindHighlights: () => c.setFindHighlights([{ blockId: m.id, start: 0, end: 1 }], 0),
      clearFindHighlights: () => c.clearFindHighlights(),
      setCommentHighlights: () => c.setCommentHighlights([]),
      clearCommentHighlights: () => c.clearCommentHighlights(),
      setSuggestionHighlights: () => c.setSuggestionHighlights([]),
      clearSuggestionHighlights: () => c.clearSuggestionHighlights(),
      findStart: () => c.findStart("hello"),
      findStatus: () => c.findStatus(),
      replaceActive: () => c.replaceActive("x"),
      replaceAll: () => c.replaceAll("x"),
      findNext: () => c.findNext(),
      findPrev: () => c.findPrev(),
      findClose: () => c.findClose(),
    } satisfies Record<keyof EditorController, HaltedCase>;
    const reads = docReads(m.docB, () => {
      results = Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, f()]));
    });
    expect(reads).toBe(0);
    expect(results.halted).toBe(true);
    expect(results.getCaretRect).toBeNull();
    expect(results.runCommand).toBe(false);
    expect(results.version).toBe(before.state);
    expect(results.mapPosition).toBeNull();
    expect(results.createAnchor).toBeNull();
    await expect(results.propose).resolves.toEqual({ ok: false, reason: "halted" });
    expect(results.exportToPdf).toMatch(/halted/);
    expect(results.findStart).toEqual({ total: 0, activeIndex: -1 });
    expect(results.findStatus).toEqual({ total: 0, activeIndex: -1 });
    expect(results.replaceAll).toEqual({ total: 0, activeIndex: -1 });
    // Setters are no-ops: the last good host set is still reported.
    expect(c.decorations.decorations.map((d) => d.id)).toEqual(["kept"]);
    expect(m.actions).toHaveLength(0);

    // Exit: the host REPLACES the document (here a fresh State over the same Y.Doc).
    m.set(freshOver(m.docB, m.rootId));
    fills = [];
    c.update(m.get());
    expect(c.halted).toBe(false);
    // The replacement dropped every layer (the host sets them again): no host set, and
    // the comment (still in the document) is no longer highlighted.
    expect(c.decorations.decorations).toEqual([]);
    expect(fills).not.toContain(core.COMMENT_HIGHLIGHT_FILL);
    typeInto(m.textarea, "!");
    expect(m.actions.map((a) => a.type)).toEqual(["DELETE_BACKWARD", "INSERT_TEXT"]);
    // The legacy write was surfaced, not merged.
    expect(core.getBlock(m.get().state, legacyId)).toBeNull();
    c.destroy();
  });

  it("a legacy-write halt is STICKY: upgradeDocument (by a peer or locally) is a no-op and never reports compatible; a fresh State over the same Y.Doc resumes and observes peers again", () => {
    const m = setup();
    const c = m.controller;
    legacyWrite(m.docA, "old");
    expect(c.halted).toBe(true);
    expect(core.upgradeDocument(m.docA, { resolver: TEST_RESOLVER }).upgradedBlocks).toEqual([]);
    expect(core.upgradeDocument(m.docB, { resolver: TEST_RESOLVER }).upgradedBlocks).toEqual([]);
    m.peer({ type: "INSERT_TEXT", text: "?" }); // later peer edits stay withheld
    expect(m.compatible()).toBe(0);
    expect(c.halted).toBe(true);
    expect(m.actions).toHaveLength(0);
    m.set(freshOver(m.docB, m.rootId));
    c.update(m.get());
    expect(c.halted).toBe(false);
    typeInto(m.textarea, "!");
    expect(core.getBlock(m.get().state, m.id)?.inlineContent?.items).toEqual([{ kind: "text", text: "!hello?", attrs: {} }]);
    // Peer changes are observed again after the resume.
    m.peer({ type: "INSERT_TEXT", text: "+" });
    expect(m.actions.some((a) => a.type === "APPLY_FOREIGN_CHANGE")).toBe(true);
    c.destroy();
  });

  it("a newer-schema or second-Yjs-instance halt is STICKY: reported once, never onDocumentCompatible, peer edits withheld", () => {
    for (const reason of ["newer-schema", "second-yjs-instance"] as const) {
      const m = setup();
      const c = m.controller;
      if (reason === "newer-schema") m.docA.getMap("meta").set("schemaVersion", core.CURRENT_SCHEMA_VERSION + 1);
      else secondInstanceWrite(m.docA, m.docB);
      expect(c.halted).toBe(true);
      expect(m.reports.map((r) => r.reason)).toEqual([reason]);
      // Nothing resumes it by itself: the schema dropping back, an upgrade, later peer edits.
      if (reason === "newer-schema") m.docA.getMap("meta").set("schemaVersion", core.CURRENT_SCHEMA_VERSION);
      core.upgradeDocument(m.docB, { resolver: TEST_RESOLVER });
      m.peer({ type: "INSERT_TEXT", text: "?" });
      expect(m.compatible()).toBe(0);
      expect(c.halted).toBe(true);
      expect(m.reports).toHaveLength(1);
      expect(m.actions).toHaveLength(0);
      c.destroy();
    }
  });

  it("resumes only on a FRESH State: a State reduced from the halted one is ignored", () => {
    const m = setup();
    legacyWrite(m.docA, "old");
    // A descendant of the halted State (the host kept reducing it): not a replacement.
    const descendant = core.reduceEditor(m.get(), { type: "APPLY_FOREIGN_CHANGE", dirtyIds: new Set([m.id]) });
    expect(descendant.state).not.toBe(m.get().state);
    expect(descendant.lastChange).not.toBeNull();
    m.controller.update(descendant);
    expect(m.controller.halted).toBe(true);
    // A fresh State over the same Y.Doc — with an edit on top (the host reduced it
    // before rendering) — resumes: its chain never reaches the halted State.
    m.set(core.reduceEditor(freshOver(m.docB, m.rootId), { type: "INSERT_TEXT", text: "!" }));
    expect(m.get().lastChange).not.toBeNull();
    m.controller.update(m.get());
    expect(m.controller.halted).toBe(false);
    m.controller.destroy();
  });

  it("update (not halted) refuses a NOT-YET-UPGRADED document: halts on it, keeps the last good render, reports compatible once it is upgraded — and a legacy write before the resume reports again", () => {
    const m = setup();
    const x = notYetUpgraded();
    const before = m.get().state;
    m.controller.update(x.editorState);
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toEqual([{ reason: "legacy-schema", legacyBlocks: ["doc", "p1"], legacyText: {} }]);
    expect(m.controller.version).toBe(before); // the old document stays shown
    core.upgradeDocument(x.doc, { resolver: TEST_RESOLVER });
    expect(m.compatible()).toBe(1);
    // A legacy client writes into the (now frozen) legacy root before the host resumed.
    x.doc.transact(() => x.doc.getMap<Y.Map<unknown>>("blocks").get("p1")?.set("inlineContent", legacyRuns("again")));
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toHaveLength(2);
    expect(m.reports[1]).toEqual({ reason: "legacy-write", legacyBlocks: ["p1"], legacyText: { p1: "again" } });
    // Further legacy writes without another "compatible" stay silent.
    x.doc.transact(() => x.doc.getMap<Y.Map<unknown>>("blocks").get("p1")?.set("inlineContent", legacyRuns("more")));
    expect(m.reports).toHaveLength(2);
    // A fresh State over the upgraded document resumes; it shows the upgraded content.
    const resumed = freshOver(x.doc, "doc" as core.BlockId);
    m.controller.update(resumed);
    expect(m.controller.halted).toBe(false);
    expect(m.controller.version).toBe(resumed.state);
    expect(core.getBlock(resumed.state, "p1" as core.BlockId)?.inlineContent?.items).toEqual([{ kind: "text", text: "legacy", attrs: {} }]);
    m.controller.destroy();
  });

  it("halted, a replacement over a NOT-YET-UPGRADED document is refused: no second report, its document is watched (its upgrade is reported), its descendants never resume", () => {
    const m = setup();
    legacyWrite(m.docA, "old");
    const x = notYetUpgraded();
    m.controller.update(x.editorState);
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toHaveLength(1);
    core.upgradeDocument(x.doc, { resolver: TEST_RESOLVER });
    expect(m.compatible()).toBe(1);
    // A State reduced from the refused replacement never resumes; a fresh one does.
    const descendant = core.reduceEditor(x.editorState, { type: "APPLY_FOREIGN_CHANGE", dirtyIds: new Set(["p1" as core.BlockId]) });
    expect(descendant.lastChange?.from).toBe(x.editorState.state);
    m.controller.update(descendant);
    expect(m.controller.halted).toBe(true);
    m.controller.update(freshOver(x.doc, "doc" as core.BlockId));
    expect(m.controller.halted).toBe(false);
    m.controller.destroy();
  });

  it("startHaltedOn a not-yet-upgraded document upgraded meanwhile fires onDocumentCompatible (microtask)", async () => {
    const x = notYetUpgraded();
    core.upgradeDocument(x.doc, { resolver: TEST_RESOLVER }); // upgraded while no controller watched
    let compatible = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const c = createEditorController(container, {
      measurer: core.createMockMeasurer(8, 16),
      dispatch: () => {},
      startHaltedOn: x.editorState,
      onDocumentCompatible: () => compatible++,
    });
    expect(c.halted).toBe(true);
    await Promise.resolve();
    expect(compatible).toBe(1);
    c.destroy();
  });

  it('halts with remoteChanges: "ignore" too (the shape check runs in every controller)', () => {
    const m = setup("hello", { remoteChanges: "ignore" });
    m.peer({ type: "INSERT_TEXT", text: "!" });
    expect(m.actions).toHaveLength(0); // ignored, as before
    const legacyId = legacyWrite(m.docA, "old");
    expect(m.reports).toEqual([{ reason: "legacy-write", legacyBlocks: [legacyId], legacyText: { [legacyId]: "old" } }]);
    expect(m.controller.halted).toBe(true);
    m.controller.destroy();
  });

  it("a halt mid-composition drops the composed textarea text; compositionend dispatches nothing", () => {
    const m = setup();
    m.textarea.focus();
    m.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    m.textarea.value = "あ";
    legacyWrite(m.docA, "old");
    expect(m.textarea.value).toBe("");
    m.textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "あ", bubbles: true }));
    expect(m.actions).toHaveLength(0);
    m.controller.destroy();
  });

  it("a11y mirror: a halt mid-composition restores the composed block's last good projection", () => {
    const m = setup("hello", { accessibilityMirror: true });
    const mirror = m.container.querySelector("[data-taleweaver-a11y-mirror]");
    if (!(mirror instanceof HTMLElement)) throw new Error("no mirror");
    expect(mirror.textContent).toBe("hello");
    mirror.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // The IME writes into the mirror DOM.
    const textNode = Array.from(mirror.querySelectorAll("*")).flatMap((e) => Array.from(e.childNodes)).find((n) => n.nodeType === 3);
    if (textNode === undefined) throw new Error("no text node");
    textNode.textContent = "helloあ";
    legacyWrite(m.docA, "old");
    expect(m.controller.halted).toBe(true);
    expect(mirror.textContent).toBe("hello");
    // A late compositionend (the IME's composed text back in the DOM) is dropped too.
    const again = Array.from(mirror.querySelectorAll("*")).flatMap((e) => Array.from(e.childNodes)).find((n) => n.nodeType === 3);
    if (again !== undefined) again.textContent = "helloい";
    mirror.dispatchEvent(new CompositionEvent("compositionend", { data: "い", bubbles: true }));
    expect(mirror.textContent).toBe("hello");
    expect(m.actions).toHaveLength(0);
    m.controller.destroy();
  });

  it("a page never painted scrolls into view while halted: it paints the last good layout, nothing throws", () => {
    const paragraphs = Array.from({ length: 80 }, (_, i) => `para ${i}`).join("\n");
    const pageConfig: core.PageConfig = {
      pageInlineSize: 300,
      pageBlockSize: 200,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 10,
    };
    const m = setup("x", { pageHeight: 200, pageGap: 10 }, { ...cfg, pageConfig });
    // Build a multi-page document on the peer and sync it before halting.
    for (const line of paragraphs.split("\n")) {
      m.peer({ type: "SPLIT_NODE" });
      m.peer({ type: "INSERT_TEXT", text: line });
    }
    const pages = [...slots.keys()];
    expect(pages.length).toBeGreaterThan(2);
    const last = Math.max(...pages);
    // The old client rewrites its replica of the LAST paragraph (on a page never laid out).
    legacyWrite(m.docA, "old", m.peerFocus());
    expect(m.controller.halted).toBe(true);
    // The page scrolls into view while halted: painted from the last good layout (the
    // virtual layout materializes a page from the styled tree, never from the Y.Doc).
    const slot = slots.get(last);
    if (slot === undefined || observeCb === null) throw new Error("setup");
    const reveal = observeCb;
    painted = [];
    expect(() => reveal(slot, true)).not.toThrow();
    expect(painted.join("")).not.toMatch(/old/);
    expect(painted.join("")).toContain("para 79");
    m.controller.destroy();
  }, /* Fixed synchronous work (~0.2 s idle); the default 5 s budget is exceeded only under parallel-suite load. */ 30_000);
});
