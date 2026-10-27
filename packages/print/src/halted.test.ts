/**
 * HALTED print controller: a peer update carrying LEGACY inline storage (an old
 * client's run-array) halts the controller — the host hook fires once, no
 * APPLY_FOREIGN_CHANGE is dispatched, typing does nothing (browser defaults are not
 * prevented), the screen keeps the last good render, every member of the controller
 * interface has a defined no-op result without reading the Y.Doc, decoration setters
 * are no-ops, and a document replacement through `update` resumes editing — on the
 * same (upgraded) Y.Doc or another one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController, type EditorControllerOptions } from "./index";

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

type HaltedCase = () => unknown;

/** Peer A (an engine of its own) and the controller under test on peer B's doc (synced A → B). */
function setup(text = "hello", extra: Partial<EditorControllerOptions> = {}) {
  let peerA = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text }, cfg);
  const docA = core.getYDoc(peerA.state);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  docA.on("update", (u: Uint8Array) => Y.applyUpdate(docB, u, "provider"));
  const stateB = core.createState({ rootId: peerA.state.rootId, doc: docB });
  let current = core.createEditorStateFromState(stateB, core.initialSelectionForState(stateB), cfg);
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
      current = core.reduceEditor(current, a, cfg);
      controller?.update(current);
    },
    config: cfg,
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
      peerA = core.reduceEditor(peerA, action, cfg);
    },
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

describe("print — HALTED on legacy storage in a peer update", () => {
  it("halts once, keeps the screen, ignores focused typing without preventing defaults, and every member is a no-op that never reads the Y.Doc", async () => {
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
    // An OLD client appends a never-seen (never-cached) paragraph in its run-array storage.
    const legacyId = appendLegacyParagraph(m.docA, m.rootId, m.id, "old client");
    expect(m.reports).toEqual([{ legacyBlocks: [legacyId] }]);
    expect(c.halted).toBe(true);
    expect(m.actions.some((a) => a.type === "APPLY_FOREIGN_CHANGE")).toBe(false);
    expect(m.get()).toBe(before); // the host state is unchanged

    // A second legacy update does not call the hook again.
    m.docA.transact(() => m.docA.getMap<Y.Map<unknown>>("blocks").get(legacyId)?.set("inlineContent", legacyRuns("again")));
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

    // Exit: the host upgrades a copy of the document (single authority) and replaces it.
    const upgraded = new Y.Doc();
    Y.applyUpdate(upgraded, Y.encodeStateAsUpdate(m.docB));
    expect(core.upgradeDocument(upgraded).upgradedBlocks).toEqual([legacyId]);
    const resumed = core.createState({ rootId: before.state.rootId, doc: upgraded });
    m.set(core.createEditorStateFromState(resumed, core.initialSelectionForState(resumed), cfg));
    fills = [];
    c.update(m.get());
    expect(c.halted).toBe(false);
    // The replacement dropped every layer (the host sets them again): no host set, and
    // the comment (still in the document) is no longer highlighted.
    expect(c.decorations.decorations).toEqual([]);
    expect(fills).not.toContain(core.COMMENT_HIGHLIGHT_FILL);
    typeInto(m.textarea, "!");
    expect(m.actions.map((a) => a.type)).toEqual(["DELETE_BACKWARD", "INSERT_TEXT"]);
    expect(core.getBlock(m.get().state, legacyId)?.inlineContent?.items).toEqual([{ kind: "text", text: "again", attrs: {} }]);
    c.destroy();
  });

  it("resumes on the SAME Y.Doc: an upgraded peer fires onDocumentCompatible once; update with a new State over it resumes", () => {
    const m = setup();
    const legacyId = appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    const c = m.controller;
    expect(c.halted).toBe(true);
    // A new State over the still-legacy doc does not resume (it fails the load check).
    const stale = core.createEditorStateFromState(m.get().state, m.get().selection, cfg);
    c.update(stale);
    expect(c.halted).toBe(true);
    expect(m.compatible()).toBe(0);
    // An upgraded peer upgrades the shared document; it syncs to B.
    core.upgradeDocument(m.docA);
    expect(m.compatible()).toBe(1);
    expect(c.halted).toBe(true); // still halted until the host replaces the document
    m.peer({ type: "INSERT_TEXT", text: "?" }); // later peer edits do not fire it again
    expect(m.compatible()).toBe(1);
    const fresh = core.createState({ rootId: m.rootId, doc: m.docB });
    m.set(core.createEditorStateFromState(fresh, core.initialSelectionForState(fresh), cfg));
    c.update(m.get());
    expect(c.halted).toBe(false);
    typeInto(m.textarea, "!");
    expect(core.getBlock(m.get().state, m.id)?.inlineContent?.items).toEqual([{ kind: "text", text: "!hello?", attrs: {} }]);
    // Peer changes are observed again after the resume.
    m.peer({ type: "INSERT_TEXT", text: "+" });
    expect(m.actions.some((a) => a.type === "APPLY_FOREIGN_CHANGE")).toBe(true);
    expect(core.getBlock(m.get().state, legacyId)).not.toBeNull();
    c.destroy();
  });

  it("the host upgrading the shared Y.Doc LOCALLY and resuming via update observes peers again", () => {
    const m = setup();
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    core.upgradeDocument(m.docB); // a LOCAL transaction: the halted gate re-checks it too
    expect(m.compatible()).toBe(1);
    const fresh = core.createState({ rootId: m.rootId, doc: m.docB });
    m.set(core.createEditorStateFromState(fresh, core.initialSelectionForState(fresh), cfg));
    m.controller.update(m.get());
    expect(m.controller.halted).toBe(false);
    // A peer edit (a raw Y.Text insert — peer A's own replica still holds the legacy block).
    const yText = m.docA.getMap<Y.Map<unknown>>("blocks").get(m.id)?.get("inlineContent");
    if (!(yText instanceof Y.Text)) throw new Error("setup");
    yText.insert(0, "+");
    expect(m.actions.map((a) => a.type)).toEqual(["APPLY_FOREIGN_CHANGE"]);
    expect(core.getBlock(m.get().state, m.id)?.inlineContent?.items).toEqual([{ kind: "text", text: "+hello", attrs: {} }]);
    m.controller.destroy();
  });

  it("resumes only on a FRESH State: a State reduced from the halted one is ignored", () => {
    const m = setup();
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    core.upgradeDocument(m.docA);
    expect(m.compatible()).toBe(1);
    // A descendant of the halted State (the host kept reducing it): not a replacement.
    const descendant = core.reduceEditor(m.get(), { type: "APPLY_FOREIGN_CHANGE", dirtyIds: new Set([m.id]) }, cfg);
    expect(descendant.state).not.toBe(m.get().state);
    expect(descendant.lastChange).not.toBeNull();
    m.controller.update(descendant);
    expect(m.controller.halted).toBe(true);
    // A fresh State over the same (upgraded) Y.Doc — with an edit on top (the host
    // reduced it before rendering) — resumes: its chain never reaches the halted State.
    const fresh = core.createState({ rootId: m.rootId, doc: m.docB });
    const replacement = core.createEditorStateFromState(fresh, core.initialSelectionForState(fresh), cfg);
    m.set(core.reduceEditor(replacement, { type: "INSERT_TEXT", text: "!" }, cfg));
    expect(m.get().lastChange).not.toBeNull();
    m.controller.update(m.get());
    expect(m.controller.halted).toBe(false);
    m.controller.destroy();
  });

  it("legacy storage returning after onDocumentCompatible (before the host resumed) reports the halt again", () => {
    const m = setup();
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    expect(m.reports).toHaveLength(1);
    core.upgradeDocument(m.docA);
    expect(m.compatible()).toBe(1);
    // An old client writes legacy storage again before the host replaced the document.
    m.docA.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("again"));
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toHaveLength(2);
    expect(m.reports[1]?.legacyBlocks).toEqual([m.id]);
    // Further legacy writes without another "compatible" stay silent.
    m.docA.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("more"));
    expect(m.reports).toHaveLength(2);
    m.controller.destroy();
  });

  it("a replacement refused for legacy storage the watch never saw (a LOCAL write after onDocumentCompatible) reports the halt again, keeps watching, and never resumes on its descendants", () => {
    const m = setup();
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    core.upgradeDocument(m.docA);
    expect(m.compatible()).toBe(1);
    const fresh = core.createState({ rootId: m.rootId, doc: m.docB });
    const replacement = core.createEditorStateFromState(fresh, core.initialSelectionForState(fresh), cfg);
    // A local (unwatched) legacy write before the host's update.
    m.docB.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("local"));
    m.controller.update(replacement);
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toHaveLength(2);
    // The document is watched halted again: its upgrade is reported.
    core.upgradeDocument(m.docB);
    expect(m.compatible()).toBe(2);
    // A State reduced from the refused replacement never resumes; a fresh one does.
    const descendant = core.reduceEditor(replacement, { type: "APPLY_FOREIGN_CHANGE", dirtyIds: new Set([m.id]) }, cfg);
    expect(descendant.lastChange?.from).toBe(replacement.state);
    m.controller.update(descendant);
    expect(m.controller.halted).toBe(true);
    const fresh2 = core.createState({ rootId: m.rootId, doc: m.docB });
    m.controller.update(core.createEditorStateFromState(fresh2, core.initialSelectionForState(fresh2), cfg));
    expect(m.controller.halted).toBe(false);
    m.controller.destroy();
  });

  it("update (not halted) refuses another Y.Doc that gained legacy storage after createState: halts on it, keeps the last good render, watches it", () => {
    const m = setup();
    const x = new Y.Doc();
    Y.applyUpdate(x, Y.encodeStateAsUpdate(m.docB));
    const fresh = core.createState({ rootId: m.rootId, doc: x });
    const replacement = core.createEditorStateFromState(fresh, core.initialSelectionForState(fresh), cfg);
    x.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("legacy"));
    const before = m.get().state;
    m.controller.update(replacement);
    expect(m.controller.halted).toBe(true);
    expect(m.reports).toEqual([{ legacyBlocks: [m.id] }]);
    expect(m.controller.version).toBe(before); // the old document stays shown
    core.upgradeDocument(x);
    expect(m.compatible()).toBe(1);
    m.controller.destroy();
  });

  it("startHaltedOn a document upgraded meanwhile fires onDocumentCompatible (microtask)", async () => {
    const m = setup();
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    const halted = m.get();
    m.controller.destroy();
    core.upgradeDocument(m.docB); // upgraded while no controller watched
    let compatible = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const c = createEditorController(container, {
      measurer: core.createMockMeasurer(8, 16),
      dispatch: () => {},
      config: cfg,
      startHaltedOn: halted,
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
    const legacyId = appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
    expect(m.reports).toEqual([{ legacyBlocks: [legacyId] }]);
    expect(m.controller.halted).toBe(true);
    m.controller.destroy();
  });

  it("a halt mid-composition drops the composed textarea text; compositionend dispatches nothing", () => {
    const m = setup();
    m.textarea.focus();
    m.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    m.textarea.value = "あ";
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
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
    appendLegacyParagraph(m.docA, m.rootId, m.id, "old");
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

  it("a page never painted, holding the legacy block, scrolls into view while halted: it paints the last good layout, nothing throws", () => {
    const paragraphs = Array.from({ length: 80 }, (_, i) => `para ${i}`).join("\n");
    const m = setup("x", {
      pageHeight: 200,
      pageGap: 10,
      pageConfig: {
        pageInlineSize: 300,
        pageBlockSize: 200,
        pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
        pageGap: 10,
      },
    });
    // Build a multi-page document on the peer and sync it before halting.
    for (const line of paragraphs.split("\n")) {
      m.peer({ type: "SPLIT_NODE" });
      m.peer({ type: "INSERT_TEXT", text: line });
    }
    const pages = [...slots.keys()];
    expect(pages.length).toBeGreaterThan(2);
    const last = Math.max(...pages);
    // The old client rewrites the LAST paragraph (on a page never laid out) with legacy storage.
    const blocks = m.docA.getMap<Y.Map<unknown>>("blocks");
    const lastId = blocks.get(m.rootId)?.get("lastChildId");
    if (typeof lastId !== "string") throw new Error("setup");
    m.docA.transact(() => blocks.get(lastId)?.set("inlineContent", legacyRuns("old")));
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
  });
});
