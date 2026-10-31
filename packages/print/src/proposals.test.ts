/**
 * Host proposals (suggestion groups) on the PRINT backend through the REAL controller:
 * propose() → host PROPOSE (mapped + validated by the host's reducer), live per-source
 * styling painted, accept / reject / undo / redo through the host loop, verdicts on
 * `lastProposal`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as core from "@taleweaver/core";
import { createEditorController, type EditorController } from "./index";

interface Fill { x: number; y: number; w: number; h: number; fillStyle: string }
interface Glyph { text: string; x: number; y: number }

const fillsOf = new WeakMap<HTMLCanvasElement, { fills: Fill[]; glyphs: Glyph[] }>();
let originalGetContext: PropertyDescriptor | undefined;
let originalIO: typeof IntersectionObserver | undefined;

beforeEach(() => {
  // Paginated mounts observe page slots: report every page visible.
  originalIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => ({
    observe: (el: Element) => cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })) as unknown as typeof IntersectionObserver;
  originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (this: HTMLCanvasElement) {
      const rec = { fills: [] as Fill[], glyphs: [] as Glyph[] };
      fillsOf.set(this, rec);
      const noop = () => {};
      return {
        canvas: this,
        font: "",
        fillStyle: "",
        strokeStyle: "",
        textBaseline: "alphabetic",
        lineWidth: 1,
        globalAlpha: 1,
        lineJoin: "miter",
        fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
          rec.fills.push({ x, y, w, h, fillStyle: this.fillStyle });
        },
        fillText(text: string, x: number, y: number) {
          rec.glyphs.push({ text, x, y });
        },
        measureText: (t: string) => ({ width: t.length * 8 }),
        clearRect: noop, moveTo: noop, lineTo: noop, stroke: noop, drawImage: noop, setTransform: noop,
        save: noop, restore: noop, scale: noop, beginPath: noop, closePath: noop, arc: noop, rect: noop,
        clip: noop, fill: noop, strokeRect: noop, setLineDash: noop,
      };
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  if (originalIO !== undefined) globalThis.IntersectionObserver = originalIO;
  if (originalGetContext !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  document.body.innerHTML = "";
});

const cfg: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
};

/**
 * Mount over a host loop. `deferred`: the host reduces every dispatch but only calls
 * `controller.update` when the test says so (`flush`) — an async / batched host.
 */
function mount(text: string, deferred = false) {
  let editor = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text });
  const container = document.createElement("div");
  document.body.appendChild(container);
  let controller: EditorController | null = null;
  controller = createEditorController(container, {
    measurer: core.createMockMeasurer(8, 16),
    dispatch: (a) => {
      editor = core.reduceEditor(editor, a);
      if (!deferred) controller?.update(editor);
    },
  });
  controller.update(editor);
  const c = controller;
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no textarea");
  const key = (k: string, mods: KeyboardEventInit = {}) =>
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, ...mods }));
  return {
    container,
    textarea,
    controller: c,
    get: () => editor,
    id: editor.selection.focus.blockId,
    flush: () => c.update(editor),
    undo: () => key("z"),
    redo: () => key("z", { shiftKey: true }),
    run: (action: core.EditorAction) => c.runCommand((_e, d) => (d?.(action), true)),
  };
}

const SOURCE_FILL = "rgb(200, 220, 255)";
const bySource: core.SuggestionGroupStyle = (g) =>
  g.metadata?.source === "assistant" ? { style: { backgroundColor: SOURCE_FILL } } : null;

/** Width of the host's per-source bands painted by `act` (fills recorded fresh). */
function paintedBands(container: HTMLElement, act: () => void): { bands: number; painted: boolean } {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  for (const c of canvases) {
    const rec = fillsOf.get(c);
    if (rec !== undefined) {
      rec.fills.length = 0;
      rec.glyphs.length = 0;
    }
  }
  act();
  let bands = 0;
  let painted = false;
  for (const c of Array.from(container.querySelectorAll("canvas"))) {
    const rec = fillsOf.get(c);
    if (rec === undefined) continue;
    painted ||= rec.glyphs.length > 0;
    for (const f of rec.fills) if (f.fillStyle === SOURCE_FILL) bands += f.w;
  }
  return { bands, painted };
}

const textOf = (e: core.EditorState, id: core.BlockId): string =>
  (core.getBlock(e.document, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
const at = (id: core.BlockId, o: number) => core.createPosition(id, o);

const swiftProposal = (id: core.BlockId, groupId = core.newSuggestionGroupId()): core.Proposal => ({
  groupId,
  author: "assistant",
  metadata: { source: "assistant" },
  edits: [
    { kind: "replace", from: at(id, 3), to: at(id, 4), text: "" },
    { kind: "replace", from: at(id, 5), to: at(id, 10), text: "swift" },
  ],
});
const ONE_GROUP = (1 + 5 + 5) * 8; // the space + "swift" + "quick"

describe("print — host proposals", () => {
  it("lands one group with live per-source styling; accept / undo / redo / reject / undo repaint it exactly", async () => {
    const m = mount("The  quick fox");
    m.controller.setSuggestionStyles(bySource);
    const groupId = core.newSuggestionGroupId();
    let verdict: Promise<core.ProposeResult> | null = null;
    const landed = paintedBands(m.container, () => {
      verdict = m.controller.propose(swiftProposal(m.id, groupId));
    });
    expect(await verdict).toEqual({ ok: true });
    expect(m.get().lastProposal).toMatchObject({ groupId, outcome: "applied" });
    expect(m.get().selection.focus).toEqual(at(m.id, 19)); // caret stays after "fox"
    expect(landed.bands).toBe(ONE_GROUP);
    const runs = core.getBlock(m.get().document, m.id)?.inlineContent?.items;

    const accepted = paintedBands(m.container, () => m.run({ type: "ACCEPT_SUGGESTION_GROUP", groupId }));
    expect(textOf(m.get(), m.id)).toBe("The swift fox");
    expect(accepted).toEqual({ bands: 0, painted: true });
    const undone = paintedBands(m.container, () => m.undo());
    expect(core.getBlock(m.get().document, m.id)?.inlineContent?.items).toEqual(runs);
    expect(core.getSuggestionGroups(m.get().document).map((g) => g.id)).toEqual([groupId]);
    expect(undone.bands).toBe(ONE_GROUP);
    m.redo();
    expect(textOf(m.get(), m.id)).toBe("The swift fox");
    m.undo();

    const rejected = paintedBands(m.container, () => m.run({ type: "REJECT_SUGGESTION_GROUP", groupId }));
    expect(textOf(m.get(), m.id)).toBe("The  quick fox");
    expect(rejected).toEqual({ bands: 0, painted: true });
    const restored = paintedBands(m.container, () => m.undo());
    expect(core.getBlock(m.get().document, m.id)?.inlineContent?.items).toEqual(runs);
    expect(restored.bands).toBe(ONE_GROUP);
    m.redo();
    expect(textOf(m.get(), m.id)).toBe("The  quick fox");
    expect(core.getSuggestions(m.get().document)).toHaveLength(0);
    m.controller.destroy();
  });

  it("basedOn: lands at mapped positions after an edit before its range; stale / rejected the promise resolves with the TRUE verdict", async () => {
    const m = mount("hello world");
    const v0 = m.controller.version;
    if (v0 === null) throw new Error("no version");
    m.run({ type: "SET_SELECTION", selection: core.createSpan(at(m.id, 0), at(m.id, 0)) });
    m.textarea.value = ">> ";
    m.textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const p = (from: number, to: number): core.Proposal => ({
      groupId: core.newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(m.id, from), to: at(m.id, to), text: "there" }],
    });
    const world = p(6, 11); // "world" in v0
    expect(await m.controller.propose(world, { basedOn: v0 })).toEqual({ ok: true });
    m.run({ type: "ACCEPT_SUGGESTION_GROUP", groupId: world.groupId });
    expect(textOf(m.get(), m.id)).toBe(">> hello there");

    const v1 = m.controller.version;
    if (v1 === null) throw new Error("no version");
    m.run({ type: "SET_SELECTION", selection: core.createSpan(at(m.id, 5), at(m.id, 5)) });
    m.textarea.value = "Z"; // inside "hello"
    m.textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const before = m.get().document;
    const hello = p(3, 8);
    expect(await m.controller.propose(hello, { basedOn: v1 })).toEqual({ ok: false, reason: "stale" });
    expect(m.get().lastProposal).toMatchObject({ groupId: hello.groupId, outcome: "stale" });
    expect(m.get().document).toBe(before);
    expect(await m.controller.propose(p(0, 2))).toEqual({ ok: true });
    const clash = await m.controller.propose(p(1, 2));
    expect(clash.ok === false && clash.reason === "rejected" ? clash.problem.kind : null).toBe("conflict");
    m.controller.destroy();
  });

  it("a host that has applied edits this controller has not seen yet: the proposal still lands on the right text; the verdict waits for the update", async () => {
    const m = mount("hello world", true);
    // The host applies an edit but has not called update() yet.
    m.run({ type: "SET_SELECTION", selection: core.createSpan(at(m.id, 0), at(m.id, 0)) });
    m.run({ type: "INSERT_TEXT", text: "Oh, " });
    expect(textOf(m.get(), m.id)).toBe("Oh, hello world");
    // The proposal targets "world" in the version the controller shows.
    const proposal: core.Proposal = {
      groupId: core.newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(m.id, 6), to: at(m.id, 11), text: "there" }],
    };
    let settled: core.ProposeResult | null = null;
    const verdict = m.controller.propose(proposal).then((r) => (settled = r));
    await Promise.resolve();
    expect(settled).toBeNull(); // the host has not shown the controller its verdict yet
    expect(m.get().lastProposal?.outcome).toBe("applied");
    m.flush();
    expect(await verdict).toEqual({ ok: true });
    m.run({ type: "ACCEPT_SUGGESTION_GROUP", groupId: proposal.groupId });
    expect(textOf(m.get(), m.id)).toBe("Oh, hello there"); // not "Oh, hthereorld"
    m.controller.destroy();
  });

  it("several proposals batched before ONE update each resolve with their own verdict", async () => {
    const m = mount("hello world", true);
    const p = (from: number, to: number): core.Proposal => ({
      groupId: core.newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(m.id, from), to: at(m.id, to), text: "x" }],
    });
    const same = p(0, 2);
    const results = Promise.all([
      m.controller.propose(same),
      m.controller.propose(p(1, 3)), // overlaps the first → conflict
      m.controller.propose(p(6, 11)),
      m.controller.propose(same), // the SAME object again: its own verdict (now a conflict)
    ]);
    m.flush();
    const [a, b, c, d] = await results;
    expect(a).toEqual({ ok: true });
    expect(b.ok === false && b.reason === "rejected" ? b.problem.kind : null).toBe("conflict");
    expect(c).toEqual({ ok: true });
    expect(d.ok === false && d.reason === "rejected" ? d.problem.kind : null).toBe("conflict");
    // More proposals between two updates than the verdict chain keeps: the oldest report
    // that their verdict aged out, every later one still gets its own.
    const many = Array.from({ length: 2 * core.MAX_PROPOSAL_CHAIN + 2 }, () =>
      m.controller.propose({ groupId: core.newSuggestionGroupId(), author: "a", edits: [] }),
    );
    m.flush();
    const verdicts = (await Promise.all(many)).map((r) => (r.ok ? "ok" : r.reason === "rejected" && r.problem.kind === "invalid" ? r.problem.message : r.reason));
    const aged = verdicts.filter((v) => v === "verdict aged out").length;
    expect(aged).toBeGreaterThan(0);
    expect(verdicts.slice(0, aged).every((v) => v === "verdict aged out")).toBe(true); // a prefix
    expect(verdicts.length - aged).toBeGreaterThanOrEqual(core.MAX_PROPOSAL_CHAIN); // at least MAX kept
    expect(verdicts.slice(aged).every((v) => /at least one/.test(v))).toBe(true); // the reducer's own verdicts
    m.controller.destroy();
  });

  it("a proposal the host dropped settles as not applied once a LATER proposal's verdict arrives", async () => {
    let editor = core.reduceEditor(core.createInitialEditorState(cfg), { type: "INSERT_TEXT", text: "hello world" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    let drop = true;
    const controller = createEditorController(container, {
      measurer: core.createMockMeasurer(8, 16),
      dispatch: (a) => {
        if (a.type === "PROPOSE" && drop) return; // the host loses this one
        editor = core.reduceEditor(editor, a);
      },
    });
    controller.update(editor);
    const id = editor.selection.focus.blockId;
    const p = (from: number, to: number): core.Proposal => ({
      groupId: core.newSuggestionGroupId(),
      author: "assistant",
      edits: [{ kind: "replace", from: at(id, from), to: at(id, to), text: "x" }],
    });
    // Well past the verdict chain's trim point first (copies of trimmed verdicts must
    // still be recognised as already seen).
    drop = false;
    for (let k = 0; k < 3 * core.MAX_PROPOSAL_CHAIN; k++) {
      const pending = controller.propose({ groupId: core.newSuggestionGroupId(), author: "a", edits: [] });
      controller.update(editor);
      expect((await pending).ok).toBe(false);
    }
    drop = true;
    const a = controller.propose(p(0, 2));
    drop = false;
    const b = controller.propose(p(6, 11));
    controller.update(editor);
    expect(await a).toEqual({ ok: false, reason: "rejected", problem: { kind: "invalid", message: "proposal was not applied by the host" } });
    expect(await b).toEqual({ ok: true });
    controller.destroy();
  });

  it("no document yet / destroyed / document replaced: rejected or stale, never left hanging", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispatch = vi.fn(); // a host that never applies anything
    const controller = createEditorController(container, { measurer: core.createMockMeasurer(8, 16), dispatch });
    const proposal: core.Proposal = { groupId: core.newSuggestionGroupId(), author: "a", edits: [] };
    const invalid = (message: string) => ({ ok: false, reason: "rejected", problem: { kind: "invalid", message } });
    expect(await controller.propose(proposal)).toEqual(invalid("no document yet"));
    expect(dispatch).not.toHaveBeenCalled();
    controller.update(core.createInitialEditorState(cfg));
    // Dispatched, but the host replaces the document before applying it → stale.
    const replacedFirst = controller.propose(proposal);
    controller.update(core.createInitialEditorState(cfg));
    expect(await replacedFirst).toEqual({ ok: false, reason: "stale" });
    // Pending when the controller is destroyed → rejected.
    const pending = controller.propose(proposal);
    controller.destroy();
    expect(await pending).toEqual(invalid("controller destroyed"));
    const calls = dispatch.mock.calls.length;
    expect(await controller.propose(proposal)).toEqual(invalid("controller destroyed"));
    expect(dispatch.mock.calls.length).toBe(calls);
  });
});
