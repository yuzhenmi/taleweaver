/**
 * React: `useEditor` exposes the print controller's HALTED state. A legacy client
 * writing into the frozen legacy root halts the real controller inside `EditorView`,
 * which tells the hook AUTOMATICALLY (no prop wiring); the hook's `halted` turns true,
 * the host's `onIncompatibleDocument` is called once, `dispatch` ignores actions;
 * `replaceDocument` resumes (the halt is sticky: an upgrade does not). A replacement
 * over a NOT-YET-UPGRADED document halts too, and that document's upgrade resumes the
 * hook by itself (it replaces the document) — also after the view was re-created while
 * halted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import * as Y from "yjs";
import * as core from "@taleweaver/core";
import { EditorView } from "./editor-view";
import { useEditor } from "./use-editor";

const RESOLVER = core.createDefaultComponentRegistry();

let originalGetContext: PropertyDescriptor | undefined;
/** The fill style of every `fillRect`, in order. */
let fills: string[] = [];
let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
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
        fillText: noop, clearRect: noop, moveTo: noop, lineTo: noop, stroke: noop, drawImage: noop,
        setTransform: noop, save: noop, restore: noop, scale: noop, beginPath: noop, closePath: noop, arc: noop,
        rect: noop, clip: noop, fill: noop, strokeRect: noop, setLineDash: noop,
      };
    },
    writable: true,
    configurable: true,
  });
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));
});

afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  if (originalResizeObserver !== undefined) globalThis.ResizeObserver = originalResizeObserver;
  document.body.innerHTML = "";
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
 * A NOT-YET-UPGRADED document: a Document bound to an empty Y.Doc, then a schema-1
 * document (`doc > p1("legacy")`) synced in.
 */
function notYetUpgraded(): { doc: Y.Doc; state: core.State } {
  const doc = new Y.Doc();
  const state = core.createState({ resolver: RESOLVER, rootId: "doc" as core.BlockId, doc });
  doc.transact(() => {
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    blocks.set("doc", legacyBlock("document", null, null, "p1"));
    blocks.set("p1", legacyBlock("paragraph", "doc", legacyRuns("legacy")));
  });
  return { doc, state };
}

const P1 = "p1" as core.BlockId;
const LEGACY_SCHEMA: core.IncompatibleDocumentReport = { reason: "legacy-schema", legacyBlocks: [core.asBlockId("doc"), P1], legacyText: {} };

/** Mount `useEditor` + `EditorView` with NO halt wiring; `remount()` re-creates the view. */
function mount(options: { readonly wrapDispatch?: boolean } = {}) {
  const hook = vi.fn();
  /** The view's own `onIncompatibleDocument` prop (an extra observer). */
  const viewHook = vi.fn();
  const box: {
    api: ReturnType<typeof useEditor> | null;
    viewKey: number;
    showView: boolean;
    decorations: readonly core.Decoration[];
    rerender: () => void;
  } = { api: null, viewKey: 0, showView: true, decorations: [], rerender: () => undefined };
  function Harness() {
    const api = useEditor({ onIncompatibleDocument: hook });
    box.api = api;
    if (!box.showView) return null;
    return (
      <EditorView
        key={box.viewKey}
        editorState={api.editorState}
        dispatch={options.wrapDispatch === true ? (a) => api.dispatch(a) : api.dispatch}
        containerRef={api.containerRef}
        measurer={api.shaper}
        decorations={box.decorations}
        onIncompatibleDocument={viewHook}
      />
    );
  }
  const r = render(<Harness />);
  box.rerender = () => r.rerender(<Harness />);
  const api = () => {
    if (box.api === null) throw new Error("not rendered");
    return box.api;
  };
  act(() => api().dispatch({ type: "INSERT_TEXT", text: "hello" }));
  const id = api().editorState.selection.focus.blockId;
  const doc = core.getYDoc(api().editorState.document);
  // A peer replica, synced both ways (the peer is an engine-less Y.Doc here).
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "peer") Y.applyUpdate(peer, u, "local");
  });
  peer.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "local") act(() => Y.applyUpdate(doc, u, "peer"));
  });
  return {
    hook,
    viewHook,
    api,
    id,
    doc,
    peer,
    remount: () => {
      box.viewKey++;
      act(() => box.rerender());
    },
    /** Show / hide the view (the hook stays mounted). */
    showView: (show: boolean) => {
      box.showView = show;
      act(() => box.rerender());
    },
    setDecorations: (decorations: readonly core.Decoration[]) => {
      box.decorations = decorations;
      act(() => box.rerender());
    },
    /** An OLD client writes its replica of the paragraph into the frozen legacy root. */
    legacyEdit: (text: string) =>
      peer.transact(() => peer.getMap<Y.Map<unknown>>("blocks").set(id, legacyBlock("paragraph", null, legacyRuns(text)))),
  };
}

const textOf = (e: core.EditorState, id: core.BlockId): string =>
  (core.getBlock(e.document, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");

describe("useEditor — HALTED", () => {
  it("the view tells the hook automatically; dispatch is ignored; replaceDocument resumes and the view re-applies its decorations", () => {
    const m = mount();
    const tint = "#123456";
    m.setDecorations([{ kind: "inline", id: "d", from: core.createPosition(m.id, 0), to: core.createPosition(m.id, 2), style: { backgroundColor: tint } }]);
    expect(fills).toContain(tint);
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(1);
    expect(m.hook).toHaveBeenCalledWith({ reason: "legacy-write", legacyBlocks: [m.id], legacyText: { [m.id]: "old" } });

    // dispatch is ignored while halted.
    const halted = m.api().editorState;
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "x" }));
    expect(m.api().editorState).toBe(halted);

    // Exit: the host replaces the document (a fresh Document over the same Y.Doc).
    fills = [];
    act(() => m.api().replaceDocument(core.createState({ resolver: RESOLVER, rootId: halted.document.rootId, doc: m.doc })));
    expect(m.api().halted).toBe(false);
    // The replacement dropped every layer; the view set its `decorations` prop again.
    expect(fills).toContain(tint);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, m.id)).toBe("!hello"); // the legacy write was not merged
  });

  it("a legacy-write halt is STICKY: an upgrade (by a peer or locally) does not resume the hook, nor does re-creating the view", async () => {
    const m = mount();
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    act(() => {
      core.bindAttrRegistry(m.peer, core.createDefaultAttrRegistry()); // no editor adopted the peer: the host binds
      core.upgradeDocument(m.peer, { resolver: RESOLVER });
      core.upgradeDocument(m.doc, { resolver: RESOLVER });
    });
    expect(m.api().halted).toBe(true);
    m.remount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(1);
  });

  it("a replacement over a NOT-YET-UPGRADED document halts the hook; its upgrade resumes the hook by itself — also after the view was re-created while halted", () => {
    const m = mount();
    const x = notYetUpgraded();
    act(() => m.api().replaceDocument(x.state));
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(1);
    expect(m.hook).toHaveBeenCalledWith(LEGACY_SCHEMA);
    // The view is re-created while halted: its controller starts halted (it is never
    // handed the halted state) and keeps watching the document.
    m.remount();
    expect(m.api().halted).toBe(true);
    act(() => {
      core.upgradeDocument(x.doc, { resolver: RESOLVER }); // the host is the single authority
    });
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, P1)).toBe("!legacy");
    expect(m.hook).toHaveBeenCalledTimes(1);
  });

  it("the controller is the source of truth: a legacy write before the resume renders, or a refused replacement, halts the hook again", () => {
    const m = mount();
    const x = notYetUpgraded();
    act(() => m.api().replaceDocument(x.state));
    expect(m.api().halted).toBe(true);
    // The upgrade resumes the hook, but an old client writes into the frozen legacy root
    // before the replacement reaches the controller.
    act(() => {
      core.upgradeDocument(x.doc, { resolver: RESOLVER });
      x.doc.transact(() => x.doc.getMap<Y.Map<unknown>>("blocks").get("p1")?.set("inlineContent", legacyRuns("again")));
    });
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(2);
    expect(m.hook).toHaveBeenLastCalledWith({ reason: "legacy-write", legacyBlocks: ["p1"], legacyText: { p1: "again" } });
    const halted = m.api().editorState;
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "x" }));
    expect(m.api().editorState).toBe(halted);
    // The host replaces the document with another not-yet-upgraded one: the controller
    // refuses it, the hook halts again — and that document's upgrade resumes it.
    const y = notYetUpgraded();
    act(() => m.api().replaceDocument(y.state));
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(3);
    expect(m.hook).toHaveBeenLastCalledWith(LEGACY_SCHEMA);
    // The view's prop observes the same halts as the hook.
    expect(m.viewHook).toHaveBeenCalledTimes(3);
    expect(m.viewHook).toHaveBeenLastCalledWith(LEGACY_SCHEMA);
    act(() => {
      core.upgradeDocument(y.doc, { resolver: RESOLVER });
    });
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, P1)).toBe("!legacy");
  });

  it("an upgrade while the view is unmounted resumes the hook when the view mounts again", async () => {
    const m = mount();
    const x = notYetUpgraded();
    act(() => m.api().replaceDocument(x.state));
    expect(m.api().halted).toBe(true);
    m.showView(false);
    core.upgradeDocument(x.doc, { resolver: RESOLVER }); // no view watches: the hook is not told yet
    expect(m.api().halted).toBe(true);
    m.showView(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, P1)).toBe("!legacy");
  });

  it("dev builds warn once when a view gets a hook's state with another (wrapped) dispatch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mount({ wrapDispatch: true });
    const linkWarnings = warn.mock.calls.filter(([msg]) => typeof msg === "string" && msg.includes("own dispatch"));
    expect(linkWarnings).toHaveLength(1);
    warn.mockClear();
    mount(); // the hook's own dispatch: no warning
    expect(warn.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes("own dispatch"))).toBe(false);
    warn.mockRestore();
  });

  it("two replaceDocument calls in one batch destroy every replaced history (no leak)", () => {
    const m = mount();
    const proto: object = Object.getPrototypeOf(m.api().editorState.history);
    const destroyed = new Set<unknown>();
    const destroy = vi.spyOn(proto as { destroy(): void }, "destroy").mockImplementation(function (this: unknown) {
      destroyed.add(this);
    });
    const original = m.api().editorState.history;
    const copy = (): core.State => {
      const d = new Y.Doc();
      Y.applyUpdate(d, Y.encodeStateAsUpdate(m.doc));
      return core.createState({ resolver: RESOLVER, rootId: m.api().editorState.document.rootId, doc: d });
    };
    act(() => {
      m.api().replaceDocument(copy());
      m.api().replaceDocument(copy());
    });
    destroy.mockRestore();
    expect(destroyed.size).toBe(2);
    expect(destroyed.has(original)).toBe(true);
    expect(destroyed.has(m.api().editorState.history)).toBe(false);
  });
});
