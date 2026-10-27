/**
 * React: `useEditor` exposes the print controller's HALTED state. A peer update
 * carrying legacy inline storage halts the real controller inside `EditorView`, which
 * tells the hook AUTOMATICALLY (no prop wiring); the hook's `halted` turns true, the
 * host's `onIncompatibleDocument` is called once, `dispatch` ignores actions;
 * `replaceDocument` with an upgraded document resumes, and so does an upgraded peer
 * upgrading the shared document (the hook replaces the document by itself) — also
 * after the view was re-created while halted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import * as Y from "yjs";
import * as core from "@taleweaver/core";
import { EditorView } from "./editor-view";
import { useEditor } from "./use-editor";

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
  originalResizeObserver = global.ResizeObserver;
  global.ResizeObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));
});

afterEach(() => {
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  if (originalResizeObserver !== undefined) global.ResizeObserver = originalResizeObserver;
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
        config={api.config}
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
  const doc = core.getYDoc(api().editorState.state);
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
    /** An OLD client rewrites the paragraph with its run-array storage. */
    legacyEdit: (text: string) =>
      peer.transact(() => peer.getMap<Y.Map<unknown>>("blocks").get(id)?.set("inlineContent", legacyRuns(text))),
  };
}

const textOf = (e: core.EditorState, id: core.BlockId): string =>
  (core.getBlock(e.state, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");

describe("useEditor — HALTED", () => {
  it("the view tells the hook automatically; dispatch is ignored; replaceDocument resumes and the view re-applies its decorations", () => {
    const m = mount();
    const tint = "#123456";
    m.setDecorations([{ kind: "inline", id: "d", from: core.createPosition(m.id, 0), to: core.createPosition(m.id, 2), style: { backgroundColor: tint } }]);
    expect(fills).toContain(tint);
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(1);
    expect(m.hook).toHaveBeenCalledWith({ legacyBlocks: [m.id] });

    // dispatch is ignored while halted.
    const halted = m.api().editorState;
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "x" }));
    expect(m.api().editorState).toBe(halted);

    // Exit: upgrade a copy (single authority) and replace the document.
    const upgraded = new Y.Doc();
    Y.applyUpdate(upgraded, Y.encodeStateAsUpdate(m.doc));
    core.upgradeDocument(upgraded);
    fills = [];
    act(() => m.api().replaceDocument(core.createState({ rootId: halted.state.rootId, doc: upgraded })));
    expect(m.api().halted).toBe(false);
    // The replacement dropped every layer; the view set its `decorations` prop again.
    expect(fills).toContain(tint);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, m.id)).toBe("!old");
  });

  it("an upgraded peer upgrading the SHARED document resumes the hook by itself — also after the view was re-created while halted", () => {
    const m = mount();
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    // The view is re-created while halted: its controller starts halted (it is never
    // handed the halted state) and keeps watching the document.
    m.remount();
    expect(m.api().halted).toBe(true);
    core.upgradeDocument(m.peer); // an upgraded peer upgrades the shared document
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, m.id)).toBe("!old");
    expect(m.hook).toHaveBeenCalledTimes(1);
  });

  it("the host upgrading the SHARED document LOCALLY resumes the hook by itself", () => {
    const m = mount();
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    act(() => {
      core.upgradeDocument(m.doc); // the host is the single authority: a local transaction
    });
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, m.id)).toBe("!old");
  });

  it("the controller is the source of truth: legacy storage returning before the resume renders, or a refused replacement, halts the hook again", () => {
    const m = mount();
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    // The upgrade resumes the hook, but an old client writes legacy storage again before
    // the replacement reaches the controller.
    act(() => {
      core.upgradeDocument(m.peer);
      m.legacyEdit("again");
    });
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(2);
    const halted = m.api().editorState;
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "x" }));
    expect(m.api().editorState).toBe(halted);
    // The host replaces the document with an upgraded copy, but legacy storage lands in
    // the copy before the replacement renders: the controller refuses it, the hook halts
    // again — and the copy's later upgrade resumes it.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(m.doc));
    core.upgradeDocument(copy);
    act(() => {
      m.api().replaceDocument(core.createState({ rootId: halted.state.rootId, doc: copy }));
      copy.transact(() => copy.getMap<Y.Map<unknown>>("blocks").get(m.id)?.set("inlineContent", legacyRuns("stale")));
    });
    expect(m.api().halted).toBe(true);
    expect(m.hook).toHaveBeenCalledTimes(3);
    expect(m.hook).toHaveBeenLastCalledWith({ legacyBlocks: [m.id] });
    // The view's prop observes the same halts as the hook.
    expect(m.viewHook).toHaveBeenCalledTimes(3);
    expect(m.viewHook).toHaveBeenLastCalledWith({ legacyBlocks: [m.id] });
    act(() => {
      core.upgradeDocument(copy);
    });
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, m.id)).toBe("!stale");
  });

  it("an upgrade while the view is unmounted resumes the hook when the view mounts again", async () => {
    const m = mount();
    m.legacyEdit("old");
    expect(m.api().halted).toBe(true);
    m.showView(false);
    core.upgradeDocument(m.peer); // no view watches: the hook is not told yet
    expect(m.api().halted).toBe(true);
    m.showView(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(m.api().halted).toBe(false);
    act(() => m.api().dispatch({ type: "INSERT_TEXT", text: "!" }));
    expect(textOf(m.api().editorState, m.id)).toBe("!old");
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
      return core.createState({ rootId: m.api().editorState.state.rootId, doc: d });
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
